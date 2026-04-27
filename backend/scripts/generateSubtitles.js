#!/usr/bin/env node

/**
 * Offline Subtitle Generator using FFmpeg and OpenAI Whisper
 * 
 * This script:
 * 1. Extracts audio from video using FFmpeg
 * 2. Transcribes audio using OpenAI Whisper (local)
 * 3. Generates WebVTT subtitle file
 * 
 * Usage:
 *   node scripts/generateSubtitles.js <video-path> [options]
 * 
 * Options:
 *   --output, -o    Output VTT file path (default: <video-name>.vtt)
 *   --model, -m     Whisper model size: tiny, base, small, medium, large (default: base)
 *   --language, -l   Language code (e.g., en, es, fr). Auto-detect if not specified
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
let videoPath = null;
let outputPath = null;
let model = 'base'; // Whisper model: tiny, base, small, medium, large
let language = null; // Auto-detect if null

// Parse arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--output' || arg === '-o') {
    outputPath = args[++i];
  } else if (arg === '--model' || arg === '-m') {
    model = args[++i];
  } else if (arg === '--language' || arg === '-l') {
    language = args[++i];
  } else if (!arg.startsWith('-') && !videoPath) {
    videoPath = arg;
  }
}

if (!videoPath) {
  console.error('❌ Error: Video file path is required');
  console.log('\nUsage:');
  console.log('  node scripts/generateSubtitles.js <video-path> [options]');
  console.log('\nOptions:');
  console.log('  --output, -o    Output VTT file path (default: <video-name>.vtt)');
  console.log('  --model, -m     Whisper model: tiny, base, small, medium, large (default: base)');
  console.log('  --language, -l   Language code (e.g., en, es, fr). Auto-detect if not specified');
  console.log('\nExample:');
  console.log('  node scripts/generateSubtitles.js video.mp4');
  console.log('  node scripts/generateSubtitles.js video.mp4 --model small --language en');
  console.log('  node scripts/generateSubtitles.js video.mp4 -o subtitles.vtt -m base');
  process.exit(1);
}

if (!existsSync(videoPath)) {
  console.error(`❌ Error: Video file not found: ${videoPath}`);
  process.exit(1);
}

// Set default output path if not provided
if (!outputPath) {
  const videoName = path.basename(videoPath, path.extname(videoPath));
  const videoDir = path.dirname(videoPath);
  outputPath = path.join(videoDir, `${videoName}.vtt`);
}

// Temporary audio file path
const tempAudioPath = path.join(path.dirname(videoPath), `temp_audio_${Date.now()}.wav`);

/**
 * Check if a command exists
 */
async function commandExists(command) {
  try {
    await execAsync(`which ${command} || where ${command}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract audio from video using FFmpeg
 */
async function extractAudio(videoPath, audioPath) {
  console.log('🎵 Step 1: Extracting audio from video...');
  
  if (!(await commandExists('ffmpeg'))) {
    throw new Error('FFmpeg is not installed. Please install FFmpeg first.');
  }

  // Extract audio as WAV format (16kHz mono, which works well with Whisper)
  const command = `ffmpeg -i "${videoPath}" -ar 16000 -ac 1 -f wav "${audioPath}" -y`;
  
  try {
    const { stdout, stderr } = await execAsync(command);
    console.log('✅ Audio extracted successfully');
    return true;
  } catch (error) {
    throw new Error(`FFmpeg error: ${error.message}`);
  }
}

/**
 * Transcribe audio using Whisper
 */
async function transcribeAudio(audioPath, model, language) {
  console.log('🎤 Step 2: Transcribing audio with Whisper...');
  console.log(`   Model: ${model}${language ? `, Language: ${language}` : ' (auto-detect)'}`);
  
  if (!(await commandExists('whisper'))) {
    throw new Error('Whisper is not installed. Please install OpenAI Whisper first.');
  }

  // Build Whisper command
  let command = `whisper "${audioPath}" --model ${model} --output_format vtt --output_dir "${path.dirname(audioPath)}"`;
  
  if (language) {
    command += ` --language ${language}`;
  }

  try {
    const { stdout, stderr } = await execAsync(command);
    console.log('✅ Transcription completed');
    
    // Whisper outputs file as <audio-name>.vtt in the same directory
    const audioName = path.basename(audioPath, path.extname(audioPath));
    const whisperOutputPath = path.join(path.dirname(audioPath), `${audioName}.vtt`);
    
    return whisperOutputPath;
  } catch (error) {
    throw new Error(`Whisper error: ${error.message}`);
  }
}

/**
 * Move and rename the VTT file to the desired output path
 */
async function moveVttFile(sourcePath, destPath) {
  const fs = await import('fs/promises');
  try {
    await fs.copyFile(sourcePath, destPath);
    await fs.unlink(sourcePath); // Remove temporary file
    console.log(`✅ Subtitle file saved: ${destPath}`);
  } catch (error) {
    throw new Error(`Error moving VTT file: ${error.message}`);
  }
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('🚀 Starting subtitle generation...');
    console.log(`📹 Video: ${videoPath}`);
    console.log(`📝 Output: ${outputPath}\n`);

    // Step 1: Extract audio
    await extractAudio(videoPath, tempAudioPath);

    // Step 2: Transcribe with Whisper
    const whisperOutputPath = await transcribeAudio(tempAudioPath, model, language);

    // Step 3: Move VTT file to desired location
    if (whisperOutputPath !== outputPath) {
      await moveVttFile(whisperOutputPath, outputPath);
    }

    // Clean up temporary audio file
    if (existsSync(tempAudioPath)) {
      unlinkSync(tempAudioPath);
      console.log('🧹 Cleaned up temporary files');
    }

    console.log('\n✨ Subtitle generation completed successfully!');
    console.log(`📄 Subtitle file: ${outputPath}`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    
    // Clean up on error
    if (existsSync(tempAudioPath)) {
      try {
        unlinkSync(tempAudioPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    
    process.exit(1);
  }
}

// Run main function
main();



