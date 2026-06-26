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

const LIBRARY_DESCRIPTION_PROMPT = `You are an expert technical writer and professional video describer. Transform the transcript below into a highly professional, academic, and executive-level summary.

Structural constraints:
- Exactly one continuous paragraph — no bullet points, no numbered lists, no line breaks.
- Extremely concise — 3 to 4 lines of text maximum.
- NEVER start any sentence with the word "This" — not "This video", "This project", "This program", "This lesson", "This analysis", "This exploration", "This work", or any variation.
- Tone: academic, corporate, technically rigorous. No informal language, no storytelling, no metaphors, no marketing words.

Content requirements:
- Focus strictly on the methodology, concepts, findings, and outcomes.
- Use industry-standard technical vocabulary.
- Ensure logical flow: topic/context → methodology/approach → insights/findings → outcome/application.
- Do NOT mention the transcript.

Bad opening examples (never do these):
"This video explains..." / "This project covers..." / "This analysis demonstrates..." / "This program shows..."

Good opening examples (start with the subject matter directly):
"Urban traffic congestion is systematically addressed through..."
"A K-Means clustering methodology segments the road network..."
"Interactive decision-making logic in software applications is developed through..."
"Ancient China's four foundational inventions — paper, compass, gunpowder, and printing —..."

Output only the final paragraph.

TITLE: {{VIDEO_TITLE}}

TRANSCRIPT:
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
    messages: [
      {
        role: 'system',
        content: 'You are an expert technical writer producing academic, executive-level video descriptions. Write in a single concise paragraph using precise technical vocabulary. No informal language, no bullet points, never start a sentence with "This".'
      },
      {
        role: 'user',
        content: buildPrompt(transcript, videoTitle)
      }
    ],
    temperature: 0.8
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

  await setAiStatus(video.id, 'processing');
  console.log(`[generateAiDescription] 🚀 Using prompt v2 for #${video.id} ${video.video_id} (transcript: ${transcript.length} chars)`);

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
