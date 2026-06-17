import OpenAI from 'openai';
import config from '../config/config.js';

let openaiClient = null;

export function getOpenAIClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.openai.apiKey,
      timeout: 120000,
      maxRetries: 3
    });
  }
  return openaiClient;
}

/**
 * Turn OpenAI / network errors into actionable messages for the admin UI.
 */
export function formatOpenAIError(error) {
  const status = error?.status ?? error?.response?.status;
  const code = error?.code ?? error?.error?.code;
  const message = error?.message || 'OpenAI request failed';

  if (status === 429 || code === 'insufficient_quota' || message.includes('quota')) {
    return (
      'OpenAI API quota exceeded. Add credits or billing at ' +
      'https://platform.openai.com/account/billing then try again.'
    );
  }

  if (status === 401 || message.includes('Incorrect API key')) {
    return 'Invalid OPENAI_API_KEY. Check backend/.env and restart the server.';
  }

  if (message.includes('maximum content size') || message.includes('25 MB')) {
    return 'Audio file is too large for OpenAI Whisper (25 MB max). Use a shorter video or pre-upload a VTT subtitle file.';
  }

  const cause = error?.cause?.code || error?.cause?.message;
  if (
    message === 'Connection error.' ||
    cause === 'ECONNRESET' ||
    cause === 'ETIMEDOUT' ||
    cause === 'ENOTFOUND'
  ) {
    return (
      'Could not reach OpenAI API (network error). Check your internet connection, firewall, or VPN. ' +
      'If the video is large, try again or upload a VTT file manually.'
    );
  }

  return message;
}
