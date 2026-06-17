/**
 * Load environment variables from backend/.env before any other config.
 * Uses an explicit path so this works when cwd differs (cPanel, scripts, cron).
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute path to the backend package root (parent of config/) */
export const backendRoot = path.resolve(__dirname, '..');

const envPath = path.join(backendRoot, '.env');

if (fs.existsSync(envPath)) {
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    console.error('[loadEnv] Failed to parse .env:', result.error.message);
  }
} else if (!process.env.OPENAI_API_KEY?.trim()) {
  console.warn(`[loadEnv] No .env file at ${envPath}`);
  console.warn('[loadEnv] Set OPENAI_API_KEY in backend/.env or cPanel Node.js environment variables.');
}

export function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getOpenAiModel() {
  return process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
}

export function getGeminiApiKey() {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

export function isGeminiConfigured() {
  return Boolean(getGeminiApiKey());
}

export function getGeminiModel() {
  return process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash-lite';
}

/** Models to try in order when the primary model is overloaded or out of quota. */
export function getGeminiModelFallbacks() {
  const primary = getGeminiModel();
  const defaults = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
  return [...new Set([primary, ...defaults])];
}

/** True when OpenAI or Gemini can generate descriptions. */
export function isAiDescriptionConfigured() {
  return isGeminiConfigured() || isOpenAiConfigured();
}

export function getAiDescriptionProvider() {
  if (process.env.AI_DESCRIPTION_PROVIDER === 'openai' && isOpenAiConfigured()) {
    return 'openai';
  }
  if (process.env.AI_DESCRIPTION_PROVIDER === 'gemini' && isGeminiConfigured()) {
    return 'gemini';
  }
  if (isGeminiConfigured()) return 'gemini';
  if (isOpenAiConfigured()) return 'openai';
  return null;
}
