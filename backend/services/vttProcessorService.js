/**
 * Shared logic for finding and processing videos that need VTT + description generation.
 * Used by the startup background job and CLI scripts.
 */

import pool from '../config/database.js';
import { ensureDescriptionColumns } from '../utils/aiStatus.js';
import { resolveVttPath } from '../utils/vttUtils.js';
import { resolveLocalVideoPath } from '../utils/videoPathResolver.js';
import { generateVttFromVideo, isVttValid } from '../utils/vttLifecycle.js';
import { setAiStatus } from '../utils/aiStatus.js';
import { markVideoInFlight, releaseVideoInFlight, isVideoInFlight } from '../utils/vttInFlight.js';

function processorConfig() {
  return {
    batchSize: Math.max(1, parseInt(process.env.VTT_BATCH_SIZE, 10) || 1),
    retryCooldownMs: parseInt(process.env.VTT_RETRY_COOLDOWN_MS, 10) || 5 * 60 * 1000,
    staleProcessingMs: parseInt(process.env.VTT_STALE_PROCESSING_MS, 10) || 30 * 60 * 1000
  };
}

/**
 * Fix inconsistent ai_status vs actual files on disk.
 */
export async function reconcileVideoAiStatus(video) {
  const aiStatus = video.ai_status || 'pending';
  const existingVtt = await resolveVttPath(video.video_id);
  const hasValidVtt = existingVtt && await isVttValid(existingVtt);
  const mp4Path = resolveLocalVideoPath(video);

  if (hasValidVtt && aiStatus !== 'done') {
    await setAiStatus(video.id, 'done');
    return 'done';
  }

  if (!mp4Path && ['pending', 'processing'].includes(aiStatus)) {
    console.warn(`[vttProcessor] No MP4 for #${video.id} ${video.video_id} — marking failed`);
    await setAiStatus(video.id, 'failed');
    return 'failed';
  }

  return aiStatus;
}
/**
 * @param {object} video - videos row
 * @param {{ retryCooldownMs?: number }} options
 */
export async function videoNeedsVttProcessing(video, options = {}) {
  const { retryCooldownMs = processorConfig().retryCooldownMs } = options;

  const aiStatus = await reconcileVideoAiStatus(video);
  video.ai_status = aiStatus;

  if (isVideoInFlight(video.id)) {
    return false;
  }

  const mp4Path = resolveLocalVideoPath(video);
  if (!mp4Path) {
    return false;
  }

  const existingVtt = await resolveVttPath(video.video_id);
  if (existingVtt && await isVttValid(existingVtt)) {
    return false;
  }

  if (aiStatus === 'processing') {
    if (isVideoInFlight(video.id)) {
      return false;
    }
    const graceMs = parseInt(process.env.VTT_PROCESSING_GRACE_MS, 10) || 2 * 60 * 1000;
    const updatedAt = video.updated_at ? new Date(video.updated_at).getTime() : 0;
    if (updatedAt > 0 && Date.now() - updatedAt < graceMs) {
      return false;
    }
    console.warn(
      `[vttProcessor] Recovering orphaned processing for #${video.id} ${video.video_id}`
    );
    return true;
  }

  if (aiStatus === 'failed') {
    const updatedAt = video.updated_at ? new Date(video.updated_at).getTime() : 0;
    if (Date.now() - updatedAt < retryCooldownMs) {
      return false;
    }
  }

  if (aiStatus === 'done') {
    return false;
  }

  return true;
}

/**
 * Find videos missing valid VTT files (includes failed retries after cooldown).
 */
export async function findVideosNeedingVtt(options = {}) {
  await ensureDescriptionColumns();

  const [videos] = await pool.execute(
    `SELECT id, video_id, title, description, file_path, ai_status, updated_at
     FROM videos
     WHERE status != 'deleted'
     ORDER BY
       CASE WHEN ai_status = 'failed' THEN 1 ELSE 0 END,
       id ASC`
  );

  const needsProcessing = [];
  for (const video of videos) {
    if (await videoNeedsVttProcessing(video, options)) {
      needsProcessing.push(video);
    }
  }

  return needsProcessing;
}

/**
 * Attempt to claim a video for processing (avoids duplicate workers).
 */
async function claimVideoForProcessing(videoId) {
  const [result] = await pool.execute(
    `UPDATE videos SET ai_status = 'processing', updated_at = NOW()
     WHERE id = ? AND ai_status IN ('pending', 'failed', 'processing')`,
    [videoId]
  );
  return result.affectedRows > 0;
}

/**
 * Process one video: Whisper → VTT → description from transcript.
 */
export async function processVideoVttAndDescription(video, options = {}) {
  const { forceDescription = true, replace = false } = options;
  const label = `#${video.id} ${video.video_id}`;

  if (isVideoInFlight(video.id)) {
    console.log(`[vttProcessor] Skipping ${label} — already in flight`);
    return { skipped: true };
  }
  const mp4Path = resolveLocalVideoPath(video);
  if (!mp4Path) {
    console.warn(`[vttProcessor] Skipping ${label} — no local MP4`);
    return { skipped: true, reason: 'no_mp4' };
  }

  const existingVtt = await resolveVttPath(video.video_id);
  if (!replace && existingVtt && await isVttValid(existingVtt)) {
    return { skipped: true, reason: 'vtt_exists' };
  }

  markVideoInFlight(video.id);

  try {
    const claimed = await claimVideoForProcessing(video.id);
    if (!claimed && (video.ai_status || 'pending') !== 'processing') {
      console.log(`[vttProcessor] Skipping ${label} — could not claim (another worker may be active)`);
      return { skipped: true, reason: 'not_claimed' };
    }

    console.log(`[vttProcessor] Processing ${label}`);
    console.log(`[vttProcessor]   MP4: ${mp4Path}`);

    await generateVttFromVideo(video, mp4Path, {
      replace,
      forceDescription,
      generateDescription: true
    });

    console.log(`[vttProcessor] ✅ Complete ${label}`);
    return { success: true };
  } catch (error) {
    console.error(`[vttProcessor] ❌ Failed ${label}:`, error.message);
    await setAiStatus(video.id, 'failed').catch(() => {});
    return { success: false, error: error.message };
  } finally {
    releaseVideoInFlight(video.id);
  }
}

/**
 * Process up to batchSize videos sequentially.
 */
export async function processVttBatch(options = {}) {
  const { batchSize = processorConfig().batchSize, ...findOptions } = options;
  const candidates = await findVideosNeedingVtt(findOptions);
  const batch = candidates.slice(0, batchSize);

  if (batch.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0, remaining: 0 };
  }

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const video of batch) {
    const result = await processVideoVttAndDescription(video, options);
    if (result.skipped) {
      skipped++;
    } else if (result.success) {
      succeeded++;
    } else {
      failed++;
    }
  }

  return {
    processed: batch.length,
    succeeded,
    failed,
    skipped,
    remaining: Math.max(0, candidates.length - batch.length)
  };
}

export { isVideoInFlight as isVideoProcessing } from '../utils/vttInFlight.js';
