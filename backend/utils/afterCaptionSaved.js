/**
 * After a VTT caption is saved, generate AI description from that file only.
 */
import { generateAiDescriptionForVideo } from './generateAiDescription.js';
import { isAiDescriptionConfigured } from '../config/loadEnv.js';

const AI_SOURCES = new Set(['openai', 'gemini']);

export async function tryGenerateDescriptionAfterCaption(video, options = {}) {
  const { force = false } = options;
  if (!video?.id || !video?.video_id) return null;

  if (!isAiDescriptionConfigured()) {
    console.log(`[afterCaptionSaved] Skipping ${video.video_id} — no GEMINI_API_KEY or OPENAI_API_KEY`);
    return null;
  }

  const hasAiDescription =
    AI_SOURCES.has(video.description_source) &&
    video.description &&
    String(video.description).trim();

  if (!force && hasAiDescription) {
    console.log(`[afterCaptionSaved] Skipping ${video.video_id} (AI description already set)`);
    return null;
  }

  try {
    return await generateAiDescriptionForVideo(video);
  } catch (error) {
    console.error(`[afterCaptionSaved] AI description failed for ${video.video_id}:`, error.message);
    return null;
  }
}
