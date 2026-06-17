/**
 * AI description generation from VTT transcript (Gemini or OpenAI only).
 */

import fs from 'fs/promises';
import pool from '../config/database.js';
import config from '../config/config.js';
import {
  isOpenAiConfigured,
  isGeminiConfigured,
  isAiDescriptionConfigured,
  getAiDescriptionProvider
} from '../config/loadEnv.js';
import { getOpenAIClient, formatOpenAIError } from './openaiClient.js';
import { generateGeminiText } from './geminiClient.js';
import { resolveVttPath, extractText } from './vttUtils.js';
import { isVttValid } from './vttLifecycle.js';
import { extractCaptionLines } from './generateDescriptionFromVtt.js';
import { setAiStatus } from './aiStatus.js';

const LIBRARY_DESCRIPTION_PROMPT = `Summarize the following video transcript into a concise, engaging 2-3 sentence description suitable for an educational/video library portal.

Rules:
- Write 2-3 complete sentences only
- Clear, student-friendly language
- No timestamps or speaker labels
- Do not mention "transcript" or "video"
- Focus on what the viewer will learn

Transcript:
----------------
{{TRANSCRIPT}}
----------------`;

function buildPrompt(transcript) {
  return LIBRARY_DESCRIPTION_PROMPT.replace('{{TRANSCRIPT}}', transcript.slice(0, 12000));
}

async function generateWithOpenAI(transcript) {
  const openai = getOpenAIClient();
  const completion = await openai.chat.completions.create({
    model: config.openai.model,
    messages: [{ role: 'user', content: buildPrompt(transcript) }],
    temperature: 0.6
  });
  const description = completion.choices[0]?.message?.content?.trim();
  if (!description) throw new Error('OpenAI returned an empty description');
  return description;
}

/**
 * Generate description using configured AI provider (Gemini preferred; OpenAI fallback on quota).
 * @returns {Promise<{ description: string, provider: 'gemini' | 'openai' }>}
 */
export async function generateLibraryDescription(transcript) {
  const primary = getAiDescriptionProvider();

  if (!primary) {
    throw new Error(
      'No AI API key configured. Set GEMINI_API_KEY or OPENAI_API_KEY in backend/.env'
    );
  }

  const prompt = buildPrompt(transcript);

  if (primary === 'gemini' || isGeminiConfigured()) {
    try {
      const description = await generateGeminiText(prompt);
      return { description, provider: 'gemini' };
    } catch (geminiError) {
      console.warn('[generateAiDescription] Gemini failed:', geminiError.message);
      if (isOpenAiConfigured()) {
        console.log('[generateAiDescription] Falling back to OpenAI…');
        try {
          const description = await generateWithOpenAI(transcript);
          return { description, provider: 'openai' };
        } catch (openaiError) {
          throw new Error(
            `${geminiError.message} OpenAI fallback also failed: ${formatOpenAIError(openaiError)} ` +
              'Add Gemini or OpenAI credits, wait a few minutes, and try again.'
          );
        }
      }
      throw geminiError;
    }
  }

  try {
    const description = await generateWithOpenAI(transcript);
    return { description, provider: 'openai' };
  } catch (error) {
    throw new Error(formatOpenAIError(error));
  }
}

export async function generateAiDescriptionForVideo(video) {
  if (!video?.id || !video?.video_id) {
    throw new Error('Video id and video_id are required');
  }

  if (!isAiDescriptionConfigured()) {
    throw new Error(
      'Set GEMINI_API_KEY or OPENAI_API_KEY in backend/.env and restart the server.'
    );
  }

  const vttPath = await resolveVttPath(video.video_id);
  if (!vttPath || !(await isVttValid(vttPath))) {
    throw new Error(
      `Subtitles not found for ${video.video_id}. Wait for automatic subtitle generation to complete.`
    );
  }

  const vttContent = await fs.readFile(vttPath, 'utf8');
  const captionLines = extractCaptionLines(vttContent);
  const transcript = captionLines.join(' ') || extractText(vttContent);

  if (!transcript || transcript.length < 20) {
    throw new Error('Subtitle transcript is too short to generate a description');
  }

  const provider = getAiDescriptionProvider();
  await setAiStatus(video.id, 'processing');

  try {
    const { description, provider: usedProvider } = await generateLibraryDescription(transcript);

    await pool.execute(
      `UPDATE videos SET description = ?, description_source = ?, ai_status = 'done' WHERE id = ?`,
      [description, usedProvider, video.id]
    );

    console.log(`[generateAiDescription] ✅ ${usedProvider} #${video.id} ${video.video_id}`);
    return { description, provider: usedProvider };
  } catch (error) {
    await setAiStatus(video.id, 'failed');
    console.error(`[generateAiDescription] ❌ #${video.id} ${video.video_id}:`, error.message);
    throw error;
  }
}
