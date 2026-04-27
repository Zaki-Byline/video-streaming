#!/usr/bin/env node

/**
 * Batch Subtitle Generator for All Videos
 * 
 * This script:
 * 1. Scans the upload folder for all .mp4 videos
 * 2. Extracts audio from each video using FFmpeg
 * 3. Transcribes audio using OpenAI Whisper (local)
 * 4. Generates WebVTT subtitle files
 * 5. Saves subtitles to the subtitles folder
 * 6. Cleans up temporary files
 * 
 * Usage:
 *   node scripts/generateSubtitlesForAllVideos.js [options]
 * 
 * Options:
 *   --model, -m     Whisper model: tiny, base, small, medium, large (default: base)
 *   --language, -l  Language code (e.g., en, es, fr). Auto-detect if not specified
 *   --skip-existing Skip videos that already have subtitle files
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readdirSync, unlinkSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const UPLOAD_DIR = path.join(__dirname, '../upload');
const SUBTITLES_DIR = path.join(__dirname, '../subtitles');

// Parse command line arguments
const args = process.argv.slice(2);
let model = 'base';
let language = null;
let skipExisting = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--model' || arg === '-m') {
    model = args[++i];
  } else if (arg === '--language' || arg === '-l') {
    language = args[++i];
  } else if (arg === '--skip-existing') {
    skipExisting = true;
  }
}

/**
 * Check if a command exists
 */
async function commandExists(command) {
  try {
    const isWindows = process.platform === 'win32';
    const checkCommand = isWindows ? `where ${command}` : `which ${command}`;
    await execAsync(checkCommand);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all .mp4 files from upload directory
 */
function getVideoFiles() {
  if (!existsSync(UPLOAD_DIR)) {
    console.error(`❌ Upload directory not found: ${UPLOAD_DIR}`);
    process.exit(1);
  }

  const files = readdirSync(UPLOAD_DIR);
  const videoFiles = files
    .filter(file => file.toLowerCase().endsWith('.mp4'))
    .map(file => ({
      filename: file,
      fullPath: path.join(UPLOAD_DIR, file),
      nameWithoutExt: path.basename(file, '.mp4')
    }));

  return videoFiles;
}

/**
 * Extract audio from video using FFmpeg
 */
async function extractAudio(videoPath, audioPath) {
  const isWindows = process.platform === 'win32';
  const escapedVideoPath = isWindows ? videoPath.replace(/"/g, '\\"') : videoPath;
  const escapedAudioPath = isWindows ? audioPath.replace(/"/g, '\\"') : audioPath;
  
  const command = `ffmpeg -i "${escapedVideoPath}" -ar 16000 -ac 1 -f wav "${escapedAudioPath}" -y`;
  
  try {
    await execAsync(command);
    return true;
  } catch (error) {
    throw new Error(`FFmpeg error: ${error.message}`);
  }
}

/**
 * Transcribe audio using Whisper
 */
async function transcribeAudio(audioPath, model, language) {
  const isWindows = process.platform === 'win32';
  const escapedAudioPath = isWindows ? audioPath.replace(/"/g, '\\"') : audioPath;
  const outputDir = path.dirname(audioPath);
  const escapedOutputDir = isWindows ? outputDir.replace(/"/g, '\\"') : outputDir;
  
  let command = `whisper "${escapedAudioPath}" --model ${model} --output_format vtt --output_dir "${escapedOutputDir}"`;
  
  if (language) {
    command += ` --language ${language}`;
  }

  try {
    await execAsync(command);
    
    // Whisper outputs file as <audio-name>.vtt in the same directory
    const audioName = path.basename(audioPath, path.extname(audioPath));
    const whisperOutputPath = path.join(outputDir, `${audioName}.vtt`);
    
    return whisperOutputPath;
  } catch (error) {
    throw new Error(`Whisper error: ${error.message}`);
  }
}

/**
 * Move VTT file to subtitles directory
 */
async function moveVttFile(sourcePath, destPath) {
  const fs = await import('fs/promises');
  try {
    await fs.copyFile(sourcePath, destPath);
    await fs.unlink(sourcePath); // Remove temporary file
    return true;
  } catch (error) {
    throw new Error(`Error moving VTT file: ${error.message}`);
  }
}

/**
 * Process a single video
 */
async function processVideo(video, model, language) {
  const videoName = video.nameWithoutExt;
  const tempAudioPath = path.join(SUBTITLES_DIR, `temp_audio_${videoName}_${Date.now()}.wav`);
  const finalVttPath = path.join(SUBTITLES_DIR, `${videoName}.vtt`);

  try {
    console.log(`\n📹 Processing: ${video.filename}`);
    console.log(`   Video: ${video.fullPath}`);

    // Step 1: Extract audio
    console.log(`   🎵 Step 1/3: Extracting audio...`);
    await extractAudio(video.fullPath, tempAudioPath);
    console.log(`   ✅ Audio extracted`);

    // Step 2: Transcribe with Whisper
    console.log(`   🎤 Step 2/3: Transcribing audio (model: ${model}${language ? `, language: ${language}` : ', auto-detect'})...`);
    const whisperOutputPath = await transcribeAudio(tempAudioPath, model, language);
    console.log(`   ✅ Transcription completed`);

    // Step 3: Move VTT file to subtitles directory
    console.log(`   📝 Step 3/3: Saving subtitle file...`);
    await moveVttFile(whisperOutputPath, finalVttPath);
    console.log(`   ✅ Subtitle saved: ${finalVttPath}`);

    // Clean up temporary audio file
    if (existsSync(tempAudioPath)) {
      unlinkSync(tempAudioPath);
    }

    console.log(`   ✨ Completed: ${video.filename}`);
    return { success: true, video: video.filename, vttPath: finalVttPath };
  } catch (error) {
    console.error(`   ❌ Error processing ${video.filename}:`, error.message);
    
    // Clean up on error
    if (existsSync(tempAudioPath)) {
      try {
        unlinkSync(tempAudioPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    
    return { success: false, video: video.filename, error: error.message };
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Starting batch subtitle generation...\n');
  console.log('='.repeat(60));
  console.log('Configuration:');
  console.log(`   Upload folder: ${UPLOAD_DIR}`);
  console.log(`   Subtitles folder: ${SUBTITLES_DIR}`);
  console.log(`   Whisper model: ${model}`);
  console.log(`   Language: ${language || 'auto-detect'}`);
  console.log(`   Skip existing: ${skipExisting ? 'Yes' : 'No'}`);
  console.log('='.repeat(60));

  // Check dependencies
  console.log('\n🔍 Checking dependencies...');
  const ffmpegInstalled = await commandExists('ffmpeg');
  const whisperInstalled = await commandExists('whisper');

  if (!ffmpegInstalled) {
    console.error('❌ FFmpeg is not installed. Please install FFmpeg first.');
    console.error('   Download: https://ffmpeg.org/download.html');
    process.exit(1);
  }
  console.log('   ✅ FFmpeg is installed');

  if (!whisperInstalled) {
    console.error('❌ Whisper is not installed. Please install OpenAI Whisper first.');
    console.error('   Install: pip install openai-whisper');
    process.exit(1);
  }
  console.log('   ✅ Whisper is installed');

  // Ensure subtitles directory exists
  if (!existsSync(SUBTITLES_DIR)) {
    mkdirSync(SUBTITLES_DIR, { recursive: true });
    console.log(`\n📁 Created subtitles directory: ${SUBTITLES_DIR}`);
  }

  // Get all video files
  console.log('\n📂 Scanning for video files...');
  const videoFiles = getVideoFiles();

  if (videoFiles.length === 0) {
    console.log('   ⚠️  No .mp4 files found in upload folder');
    process.exit(0);
  }

  console.log(`   ✅ Found ${videoFiles.length} video file(s)\n`);

  // Filter out videos that already have subtitles (if skip-existing is enabled)
  let videosToProcess = videoFiles;
  if (skipExisting) {
    videosToProcess = videoFiles.filter(video => {
      const vttPath = path.join(SUBTITLES_DIR, `${video.nameWithoutExt}.vtt`);
      if (existsSync(vttPath)) {
        console.log(`   ⏭️  Skipping ${video.filename} (subtitle already exists)`);
        return false;
      }
      return true;
    });
    console.log(`\n📊 Processing ${videosToProcess.length} of ${videoFiles.length} video(s) (${videoFiles.length - videosToProcess.length} skipped)\n`);
  }

  if (videosToProcess.length === 0) {
    console.log('   ✅ All videos already have subtitles!');
    process.exit(0);
  }

  // Process each video
  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < videosToProcess.length; i++) {
    const video = videosToProcess[i];
    console.log(`\n[${i + 1}/${videosToProcess.length}]`);
    
    const result = await processVideo(video, model, language);
    results.push(result);
    
    if (result.success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary:');
  console.log(`   Total videos: ${videosToProcess.length}`);
  console.log(`   ✅ Successful: ${successCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log('='.repeat(60));

  if (failCount > 0) {
    console.log('\n❌ Failed videos:');
    results
      .filter(r => !r.success)
      .forEach(r => {
        console.log(`   - ${r.video}: ${r.error}`);
      });
  }

  if (successCount > 0) {
    console.log('\n✨ Subtitle generation completed!');
    console.log(`   Subtitles saved to: ${SUBTITLES_DIR}`);
  }

  process.exit(failCount > 0 ? 1 : 0);
}

// Run main function
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});



