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

const LIBRARY_DESCRIPTION_PROMPT = `Write a video library description from the subtitle transcript below.

STEP 1 — Pick the content type (from transcript only; do not label it in output):
• Project — science, electronics, coding, robotics, engineering, or hands-on build
• Lesson — concept, skill, emotion, or educational topic
• Story — story, fairy tale, or fictional narrative

STEP 2 — Write 80–150 words in a natural human voice, like someone explaining after watching.

How to write:
• Simple, casual, easy to read — mix short and medium sentences
• Rewrite in your own words; never copy transcript sentences
• Use only facts from the transcript; title is for context only
• Do not invent parts, characters, or ideas not in the transcript
• Short paragraphs are fine
• Output the description only — no headings or type labels

Banned phrases (and similar AI/formal wording):
Discover how, Learn how, Explore, Dive into, This exciting project, In this project we will,
This content focuses on, The video explores, This segment discusses, The video begins,
It then explains, In conclusion.

VIDEO TITLE:
{{VIDEO_TITLE}}

SUBTITLE TRANSCRIPT:
{{TRANSCRIPT}}`;

function buildPrompt(transcript, videoTitle = '') {
  return LIBRARY_DESCRIPTION_PROMPT
    .replace('{{VIDEO_TITLE}}', (videoTitle || 'Untitled').trim())
    .replace('{{TRANSCRIPT}}', transcript.slice(0, 12000));
}

async function generateWithOpenAI(transcript, videoTitle) {
  const openai = getOpenAIClient();
  const completion = await openai.chat.completions.create({
    model: config.openai.model,
    messages: [{ role: 'user', content: buildPrompt(transcript, videoTitle) }],
    temperature: 0.5
  });
  const description = completion.choices[0]?.message?.content?.trim();
  if (!description) throw new Error('OpenAI returned an empty description');
  return description;
}

/**
 * Generate description using configured AI provider (Gemini preferred; OpenAI fallback on quota).
 * @returns {Promise<{ description: string, provider: 'gemini' | 'openai' }>}
 */
export async function generateLibraryDescription(transcript, videoTitle = '') {
  const primary = getAiDescriptionProvider();

  if (!primary) {
    throw new Error(
      'No AI API key configured. Set GEMINI_API_KEY or OPENAI_API_KEY in backend/.env'
    );
  }

  const prompt = buildPrompt(transcript, videoTitle);

  if (primary === 'gemini' || isGeminiConfigured()) {
    try {
      const description = await generateGeminiText(prompt);
      return { description, provider: 'gemini' };
    } catch (geminiError) {
      console.warn('[generateAiDescription] Gemini failed:', geminiError.message);
      if (isOpenAiConfigured()) {
        console.log('[generateAiDescription] Falling back to OpenAI…');
        try {
          const description = await generateWithOpenAI(transcript, videoTitle);
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
    const description = await generateWithOpenAI(transcript, videoTitle);
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
    const { description, provider: usedProvider } = await generateLibraryDescription(
      transcript,
      video.title || ''
    );

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
