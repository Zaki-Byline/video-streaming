#!/usr/bin/env node

/**
 * Verify OpenAI environment configuration.
 * Usage: npm run check-openai
 */

import '../config/loadEnv.js';
import { backendRoot, isOpenAiConfigured, getOpenAiModel } from '../config/loadEnv.js';
import fs from 'fs';
import path from 'path';

const envPath = path.join(backendRoot, '.env');

console.log('\n=== OpenAI configuration check ===\n');
console.log('Backend root:', backendRoot);
console.log('.env path:   ', envPath);
console.log('.env exists: ', fs.existsSync(envPath));
console.log('OPENAI_API_KEY set:', isOpenAiConfigured());
console.log('OPENAI_MODEL:      ', getOpenAiModel());

if (!isOpenAiConfigured()) {
  console.log('\n❌ OPENAI_API_KEY is missing or empty.\n');
  console.log('Local fix:');
  console.log('  1. Edit backend/.env');
  console.log('  2. Set: OPENAI_API_KEY=sk-your-key-here');
  console.log('  3. Restart backend: npm run dev (or npm start)\n');
  console.log('cPanel fix:');
  console.log('  1. cPanel → Setup Node.js App → your app');
  console.log('  2. Environment Variables → Add OPENAI_API_KEY');
  console.log('  3. Restart the Node.js application\n');
  process.exit(1);
}

console.log('\n✅ OpenAI API key is loaded (starts with:', process.env.OPENAI_API_KEY.slice(0, 7) + '...)\n');
process.exit(0);
