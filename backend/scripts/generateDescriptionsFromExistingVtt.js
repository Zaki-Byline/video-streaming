#!/usr/bin/env node

/**
 * Bulk-generate descriptions from existing VTT files only.
 * Does not process MP4 or call Whisper/OpenAI transcription.
 *
 * Usage:
 *   node scripts/generateDescriptionsFromExistingVtt.js
 *   npm run generate-descriptions-from-vtt
 */

import '../config/loadEnv.js';
import pool from '../config/database.js';
import { generateDescriptionFromVtt } from '../utils/generateDescriptionFromVtt.js';
import { resolveVttPath } from '../utils/vttUtils.js';

const BATCH_SIZE = 25;

async function fetchBatch(offset, missingOnly) {
  const where = missingOnly
    ? `status != 'deleted' AND (description IS NULL OR description = '')`
    : `status != 'deleted'`;

  const [rows] = await pool.execute(
    `SELECT id, video_id, title, description
     FROM videos
     WHERE ${where}
     ORDER BY id ASC
     LIMIT ? OFFSET ?`,
    [BATCH_SIZE, offset]
  );
  return rows;
}

async function main() {
  const missingOnly = !process.argv.includes('--all');

  console.log('[generateDescriptionsFromVtt] Starting…');
  console.log(`[generateDescriptionsFromVtt] Mode: ${missingOnly ? 'missing descriptions only' : 'all videos'}`);

  let offset = 0;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const errors = [];

  while (true) {
    const batch = await fetchBatch(offset, missingOnly);
    if (batch.length === 0) break;

    for (const video of batch) {
      processed++;
      const vttPath = await resolveVttPath(video.video_id);

      if (!vttPath) {
        skipped++;
        errors.push({ id: video.id, video_id: video.video_id, error: 'VTT file not found' });
        console.warn(`[generateDescriptionsFromVtt] ⏭️  #${video.id} — no VTT`);
        continue;
      }

      try {
        await generateDescriptionFromVtt(video, { vttPath });
        succeeded++;
      } catch (error) {
        failed++;
        errors.push({ id: video.id, video_id: video.video_id, error: error.message });
        console.error(`[generateDescriptionsFromVtt] ❌ #${video.id}: ${error.message}`);
      }
    }

    offset += BATCH_SIZE;
    if (batch.length < BATCH_SIZE) break;
  }

  console.log('\n=== Summary ===');
  console.log(`processed: ${processed}`);
  console.log(`succeeded: ${succeeded}`);
  console.log(`failed:    ${failed}`);
  console.log(`skipped:   ${skipped} (no VTT)`);

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[generateDescriptionsFromVtt] Fatal:', error);
  process.exit(1);
});
