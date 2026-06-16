/**
 * After a VTT caption is saved, generate description from that file only.
 * Non-blocking callers should wrap in try/catch.
 */
import { generateDescriptionFromVtt } from './generateDescriptionFromVtt.js';

export async function tryGenerateDescriptionAfterCaption(video, options = {}) {
  const { force = false } = options;
  if (!video?.id || !video?.video_id) return null;

  const hasDescription = video.description && String(video.description).trim();
  if (!force && hasDescription) {
    return null;
  }

  return generateDescriptionFromVtt(video, { regenerate: force });
}
