/**
 * Generate video descriptions from existing VTT subtitle files.
 * No MP4 processing. No Whisper/OpenAI transcription required.
 * Uses local text summarization; optional OpenAI if configured (USE_OPENAI_FOR_DESCRIPTIONS=true).
 */

import fs from 'fs/promises';
import pool from '../config/database.js';
import { isOpenAiConfigured } from '../config/loadEnv.js';
import { getOpenAIClient, formatOpenAIError } from './openaiClient.js';
import config from '../config/config.js';
import { resolveVttPath, extractText } from './vttUtils.js';
import { ensureDescriptionColumns, setAiStatus } from './aiStatus.js';

export { ensureDescriptionColumns };

const TIMESTAMP_LINE = /^\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}/;

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'it', 'its', 'this', 'that',
  'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'what', 'which', 'who',
  'whom', 'whose', 'where', 'when', 'why', 'how', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there', 'then',
  'once', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further', 'once', 'um', 'uh',
  'like', 'yeah', 'okay', 'ok', 'well', 'right', 'going', 'know', 'think', 'really'
]);

const METADATA_PROMPT = `You are an expert educational content writer.

From the transcript below, return ONLY valid JSON (no markdown) in this exact shape:
{"description":"50-150 word educational summary","keywords":["word1","word2"],"tags":["tag1","tag2"]}

Rules:
- description: clear, simple, for students, no timestamps, 50-150 words
- keywords: 5-8 search terms
- tags: 5-10 topic tags
- Do not mention "transcript"

Transcript:
----------------
{{TRANSCRIPT}}
----------------`;

/**
 * Parse VTT into deduplicated caption lines (not merged blob).
 */
export function extractCaptionLines(vttContent) {
  if (!vttContent) return [];

  const lines = vttContent
    .replace(/^WEBVTT[^\n]*\n?/i, '')
    .replace(/NOTE\s+[\s\S]*?(?=\n\n|\n\d|$)/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^\d+$/.test(line)) return false;
      if (TIMESTAMP_LINE.test(line)) return false;
      if (line.startsWith('NOTE')) return false;
      return true;
    })
    .map((line) => line.replace(/<[^>]+>/g, ''));

  const deduped = [];
  for (const line of lines) {
    const normalized = line.toLowerCase();
    if (!deduped.length || deduped[deduped.length - 1].toLowerCase() !== normalized) {
      deduped.push(line);
    }
  }
  return deduped;
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Build description, keywords, tags locally from transcript text.
 */
export function buildMetadataFromTranscript(transcript, title = '', captionLines = null) {
  const sentences = captionLines?.length
    ? captionLines
    : transcript.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 10);

  const descriptionParts = [];
  let wordCount = 0;
  for (const sentence of sentences) {
    const words = countWords(sentence);
    if (wordCount + words > 150 && wordCount >= 50) break;
    descriptionParts.push(sentence);
    wordCount += words;
    if (wordCount >= 150) break;
  }

  let description = descriptionParts.join(' ').trim();
  if (countWords(description) < 50 && sentences.length > 0) {
    description = sentences.slice(0, 8).join(' ').trim();
  }
  if (description.length > 900) {
    description = description.slice(0, 900).replace(/\s+\S*$/, '') + '…';
  }

  const tokens = (transcript + ' ' + title)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));

  const freq = new Map();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }

  const ranked = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);

  const keywords = ranked.slice(0, 8);
  const tags = [...new Set([...ranked.slice(0, 6), ...title.toLowerCase().split(/\s+/).filter((w) => w.length >= 3)])]
    .slice(0, 10);

  return {
    description: description || transcript.slice(0, 500).trim(),
    keywords,
    tags
  };
}

async function generateWithOpenAI(transcript) {
  const openai = getOpenAIClient();
  const completion = await openai.chat.completions.create({
    model: config.openai.model,
    messages: [{
      role: 'user',
      content: METADATA_PROMPT.replace('{{TRANSCRIPT}}', transcript.slice(0, 12000))
    }],
    response_format: { type: 'json_object' }
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error('OpenAI returned empty metadata');

  const parsed = JSON.parse(raw);
  return {
    description: String(parsed.description || '').trim(),
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : []
  };
}

function useOpenAiForDescriptions() {
  return (
    process.env.USE_OPENAI_FOR_DESCRIPTIONS === 'true' &&
    isOpenAiConfigured()
  );
}

/**
 * Read VTT and produce description metadata.
 */
export async function buildMetadataFromVtt(vttContent, title = '') {
  const captionLines = extractCaptionLines(vttContent);
  const transcript = captionLines.join(' ') || extractText(vttContent);

  if (!transcript || transcript.length < 20) {
    throw new Error('Transcript is too short to generate a description');
  }

  if (useOpenAiForDescriptions()) {
    try {
      return await generateWithOpenAI(transcript);
    } catch (error) {
      console.warn('[generateDescriptionFromVtt] OpenAI failed, using local summarizer:', formatOpenAIError(error));
    }
  }

  return buildMetadataFromTranscript(transcript, title, captionLines);
}

/**
 * Generate description from VTT — OpenAI only (delegates to generateAiDescriptionForVideo).
 */
export async function generateDescriptionFromVtt(video, options = {}) {
  const { regenerate = false } = options;

  if (!regenerate && ['openai', 'gemini'].includes(video.description_source) && video.description?.trim()) {
    return { description: video.description };
  }

  const { generateAiDescriptionForVideo } = await import('./generateAiDescription.js');
  return generateAiDescriptionForVideo(video);
}

/** @deprecated Use generateDescriptionFromVtt */
export async function generateDescriptionForVideo(video, options = {}) {
  return generateDescriptionFromVtt(video, options);
}
