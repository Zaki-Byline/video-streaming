/**
 * Google Gemini API client for AI description generation.
 */

import { getGeminiApiKey, getGeminiModelFallbacks } from '../config/loadEnv.js';

function extractGeminiText(data) {
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join('')
    .trim();
  return text || null;
}

function isQuotaError(message = '') {
  const m = message.toLowerCase();
  return m.includes('quota') || m.includes('resource_exhausted') || m.includes('limit: 0');
}

function isHighDemandError(message = '') {
  const m = message.toLowerCase();
  return (
    m.includes('high demand') ||
    m.includes('overloaded') ||
    m.includes('unavailable') ||
    m.includes('try again later')
  );
}

/** Transient or capacity errors — retry and/or try the next model. */
function isRetryableError(error) {
  const message = error?.message || '';
  const status = error?.status;
  if (status === 429 || status === 503 || status === 500) return true;
  if (isQuotaError(message) || isHighDemandError(message)) return true;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatGeminiError(error, responseBody = null) {
  const message = error?.message || responseBody?.error?.message || 'Gemini API request failed';
  if (message.includes('API key not valid') || message.includes('API_KEY_INVALID')) {
    return 'Invalid GEMINI_API_KEY. Check backend/.env and restart the server.';
  }
  if (isHighDemandError(message)) {
    return (
      'Gemini is temporarily overloaded. Wait a minute and try again, or set GEMINI_MODEL=gemini-2.5-flash-lite in backend/.env.'
    );
  }
  if (isQuotaError(message)) {
    return (
      'Gemini quota exceeded for this model. Set GEMINI_MODEL=gemini-2.5-flash-lite in backend/.env ' +
      'or enable billing in Google AI Studio (https://aistudio.google.com/).'
    );
  }
  return message;
}

async function callGeminiModel(model, prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5 }
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err = new Error(data?.error?.message || response.statusText);
    err.status = response.status;
    err.retryable = isRetryableError(err);
    throw err;
  }

  const text = extractGeminiText(data);
  if (!text) {
    throw new Error('Gemini returned an empty response');
  }

  return { text, model };
}

const MAX_ATTEMPTS_PER_MODEL = 3;
const RETRY_DELAYS_MS = [2000, 5000];

/**
 * Generate text using Gemini with per-model retries and model fallbacks.
 */
export async function generateGeminiText(prompt) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const models = getGeminiModelFallbacks();
  let lastError = null;

  for (const model of models) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const result = await callGeminiModel(model, prompt, apiKey);
        if (model !== models[0]) {
          console.log(`[geminiClient] Used fallback model: ${model}`);
        }
        return result.text;
      } catch (error) {
        lastError = error;
        const retryable = error.retryable;
        const hasMoreAttempts = attempt < MAX_ATTEMPTS_PER_MODEL - 1;

        if (retryable && hasMoreAttempts) {
          const delay = RETRY_DELAYS_MS[attempt] ?? 8000;
          console.warn(
            `[geminiClient] ${model} attempt ${attempt + 1} failed (${error.message}), retrying in ${delay}ms…`
          );
          await sleep(delay);
          continue;
        }

        if (retryable) {
          console.warn(`[geminiClient] ${model} exhausted retries, trying next model…`);
          break;
        }

        throw new Error(formatGeminiError(error));
      }
    }
  }

  throw new Error(formatGeminiError(lastError));
}
