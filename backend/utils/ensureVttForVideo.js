import { resolveVttPath } from './vttUtils.js';
import { ensureVttFromVideo, isVttValid } from './vttLifecycle.js';
import pool from '../config/database.js';

export async function hasVttFile(videoId) {
  return Boolean(await resolveVttPath(videoId));
}

export function canGenerateDescription(video) {
  return hasVttFile(video.video_id).then((hasVtt) => {
    if (hasVtt) return { ok: true, mode: 'vtt' };
    return {
      ok: false,
      error: `VTT file not found for ${video.video_id}. Upload or regenerate subtitles first.`
    };
  });
}

/**
 * Ensure VTT exists; regenerate from video if missing or corrupt.
 */
export async function ensureVttForVideo(videoOrId) {
  let video = videoOrId;

  if (typeof videoOrId === 'string') {
    const [rows] = await pool.execute(
      'SELECT * FROM videos WHERE video_id = ? LIMIT 1',
      [videoOrId]
    );
    video = rows[0];
    if (!video) {
      throw new Error(`Video not found: ${videoOrId}`);
    }
  }

  const existing = await resolveVttPath(video.video_id);
  if (existing && await isVttValid(existing)) return existing;

  return ensureVttFromVideo(video);
}
