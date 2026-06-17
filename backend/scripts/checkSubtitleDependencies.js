#!/usr/bin/env node

/**
 * Check if all required dependencies for subtitle generation are installed
 * 
 * Usage: node scripts/checkSubtitleDependencies.js
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { isFfmpegAvailable } from '../utils/resolveFfmpeg.js';
import { isOpenAiConfigured } from '../config/loadEnv.js';

const execAsync = promisify(exec);

async function checkCommand(command, name) {
  try {
    const isWindows = process.platform === 'win32';
    const checkCmd = isWindows ? `where ${command}` : `which ${command}`;
    await execAsync(checkCmd);
    return { installed: true, name };
  } catch {
    return { installed: false, name };
  }
}

async function checkPythonVersion() {
  try {
    const { stdout } = await execAsync('python --version');
    return { installed: true, version: stdout.trim(), name: 'Python' };
  } catch {
    try {
      const { stdout } = await execAsync('python3 --version');
      return { installed: true, version: stdout.trim(), name: 'Python3' };
    } catch {
      return { installed: false, name: 'Python' };
    }
  }
}

async function checkFfmpeg() {
  return { installed: await isFfmpegAvailable() };
}

async function checkWhisper() {
  try {
    await execAsync('whisper --help');
    return { installed: true, name: 'Whisper' };
  } catch {
    return { installed: false, name: 'Whisper' };
  }
}

async function main() {
  console.log('🔍 Checking subtitle generation dependencies...\n');

  const checks = [
    { ...(await checkFfmpeg()), name: 'FFmpeg' },
    await checkPythonVersion(),
    await checkWhisper(),
    { installed: isOpenAiConfigured(), name: 'OpenAI transcription (fallback)' }
  ];

  const ffmpegOk = checks[0].installed;
  const whisperOk = checks[2].installed;
  const openaiOk = checks[3].installed;
  const allInstalled = ffmpegOk && (whisperOk || openaiOk);

  checks.forEach(check => {
    if (check.installed) {
      console.log(`✅ ${check.name} is installed${check.version ? ` (${check.version})` : ''}`);
    } else {
      console.log(`❌ ${check.name} is NOT installed`);
    }
  });

  console.log('\n' + '='.repeat(50));

  if (allInstalled) {
    console.log('✨ Ready for subtitle generation!');
    if (!whisperOk && openaiOk) {
      console.log('   Using bundled FFmpeg + OpenAI Whisper API for transcription.');
    }
    console.log('You can generate subtitles using:');
    console.log('  node scripts/generateSubtitles.js <video-path>');
  } else {
    console.log('⚠️  Some dependencies are missing.');
    console.log('\nPlease install missing dependencies:');
    console.log('1. FFmpeg: https://ffmpeg.org/download.html');
    console.log('2. Python: https://www.python.org/downloads/');
    console.log('3. Whisper: pip install openai-whisper');
    console.log('\nSee SUBTITLE_GENERATION_GUIDE.md for detailed instructions.');
  }
}

main().catch(console.error);



