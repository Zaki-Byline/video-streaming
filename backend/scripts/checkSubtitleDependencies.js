#!/usr/bin/env node

/**
 * Check if all required dependencies for subtitle generation are installed
 * 
 * Usage: node scripts/checkSubtitleDependencies.js
 */

import { exec } from 'child_process';
import { promisify } from 'util';

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
    await checkCommand('ffmpeg', 'FFmpeg'),
    await checkPythonVersion(),
    await checkWhisper()
  ];

  let allInstalled = true;

  checks.forEach(check => {
    if (check.installed) {
      console.log(`✅ ${check.name} is installed${check.version ? ` (${check.version})` : ''}`);
    } else {
      console.log(`❌ ${check.name} is NOT installed`);
      allInstalled = false;
    }
  });

  console.log('\n' + '='.repeat(50));

  if (allInstalled) {
    console.log('✨ All dependencies are installed!');
    console.log('You can now generate subtitles using:');
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



