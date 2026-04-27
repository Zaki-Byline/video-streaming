#!/usr/bin/env node

/**
 * Generate Subtitles for ALL Videos and Import to Caption System
 * 
 * This script:
 * 1. Scans the upload folder for all .mp4 videos
 * 2. For each video, checks if it exists in the database
 * 3. Generates subtitles using Whisper
 * 4. Imports subtitles to video-storage/captions/ and database
 * 
 * Usage:
 *   node scripts/generateAndImportAllSubtitles.js [options]
 * 
 * Options:
 *   --model, -m     Whisper model: tiny, base, small, medium, large (default: base)
 *   --language, -l  Language code (e.g., en, es, fr). Auto-detect if not specified
 *   --skip-existing Skip videos that already have captions in database
 */

import { readdirSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';
import { generateSubtitles } from '../utils/subtitleGenerator.js';
import { ensureDirectoryExists } from '../utils/fileUtils.js';
import * as captionService from '../services/captionService.js';
import fs from 'fs/promises';

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
 * Find video in database by filename or video_id
 */
async function findVideoInDatabase(videoName) {
  try {
    // Try to find by file_path containing the filename
    const [rowsByPath] = await pool.execute(
      `SELECT * FROM videos WHERE file_path LIKE ? OR file_path LIKE ?`,
      [`%${videoName}%`, `%${path.basename(videoName)}%`]
    );
    
    if (rowsByPath.length > 0) {
      return rowsByPath[0];
    }
    
    // Try to find by video_id matching the filename (without extension)
    const videoIdFromName = videoName.replace(/\.mp4$/i, '');
    if (videoIdFromName.startsWith('VID_')) {
      const [rowsById] = await pool.execute(
        `SELECT * FROM videos WHERE video_id = ?`,
        [videoIdFromName]
      );
      
      if (rowsById.length > 0) {
        return rowsById[0];
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Error finding video in database:`, error.message);
    return null;
  }
}

/**
 * Check if video already has captions
 */
async function hasCaptions(videoId) {
  try {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as count FROM captions WHERE video_id = ?`,
      [videoId]
    );
    return rows[0].count > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Process a single video
 */
async function processVideo(video, model, language) {
  try {
    console.log(`\n📹 Processing: ${video.filename}`);
    
    // Step 1: Find video in database
    console.log(`   🔍 Step 1/4: Looking up video in database...`);
    const dbVideo = await findVideoInDatabase(video.filename);
    
    if (!dbVideo) {
      console.log(`   ⚠️  Video not found in database. Skipping (video needs to be uploaded first).`);
      return { success: false, video: video.filename, error: 'Video not in database' };
    }
    
    const videoId = dbVideo.video_id;
    console.log(`   ✅ Found video in database: ${videoId}`);
    
    // Step 2: Check if already has captions (if skip-existing is enabled)
    if (skipExisting) {
      const hasExisting = await hasCaptions(videoId);
      if (hasExisting) {
        console.log(`   ⏭️  Video already has captions. Skipping.`);
        return { success: true, video: video.filename, skipped: true };
      }
    }
    
    // Step 3: Generate subtitles
    console.log(`   🎤 Step 2/4: Generating subtitles (model: ${model}${language ? `, language: ${language}` : ', auto-detect'})...`);
    
    // Ensure subtitles directory exists
    await ensureDirectoryExists(SUBTITLES_DIR);
    const tempSubtitlePath = path.join(SUBTITLES_DIR, `${video.nameWithoutExt}.vtt`);
    
    await generateSubtitles(video.fullPath, {
      outputPath: tempSubtitlePath,
      model: model,
      language: language
    });
    
    console.log(`   ✅ Subtitles generated: ${tempSubtitlePath}`);
    
    // Step 4: Import to caption system
    console.log(`   📝 Step 3/4: Importing to caption system...`);
    
    const subtitleBuffer = await fs.readFile(tempSubtitlePath);
    await captionService.uploadCaption(videoId, 'en', subtitleBuffer, `${video.nameWithoutExt}.vtt`);
    
    console.log(`   ✅ Caption saved to video-storage/captions/ and added to database`);
    
    // Step 5: Clean up temp subtitle file (optional - you can keep it if you want)
    // await fs.unlink(tempSubtitlePath).catch(() => {});
    
    console.log(`   ✨ Completed: ${video.filename} (Video ID: ${videoId})`);
    return { success: true, video: video.filename, videoId: videoId, vttPath: tempSubtitlePath };
    
  } catch (error) {
    console.error(`   ❌ Error processing ${video.filename}:`, error.message);
    return { success: false, video: video.filename, error: error.message };
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Starting subtitle generation and import for ALL videos...\n');
  console.log('='.repeat(70));
  console.log('Configuration:');
  console.log(`   Upload folder: ${UPLOAD_DIR}`);
  console.log(`   Subtitles folder: ${SUBTITLES_DIR}`);
  console.log(`   Whisper model: ${model}`);
  console.log(`   Language: ${language || 'auto-detect'}`);
  console.log(`   Skip existing: ${skipExisting ? 'Yes' : 'No'}`);
  console.log('='.repeat(70));

  // Ensure directories exist
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

  // Process each video
  const results = [];
  let successCount = 0;
  let skippedCount = 0;
  let failCount = 0;

  for (let i = 0; i < videoFiles.length; i++) {
    const video = videoFiles[i];
    console.log(`\n[${i + 1}/${videoFiles.length}]`);
    
    const result = await processVideo(video, model, language);
    results.push(result);
    
    if (result.success) {
      if (result.skipped) {
        skippedCount++;
      } else {
        successCount++;
      }
    } else {
      failCount++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 Summary:');
  console.log(`   Total videos: ${videoFiles.length}`);
  console.log(`   ✅ Successful: ${successCount}`);
  console.log(`   ⏭️  Skipped: ${skippedCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log('='.repeat(70));

  if (failCount > 0) {
    console.log('\n❌ Failed videos:');
    results
      .filter(r => !r.success)
      .forEach(r => {
        console.log(`   - ${r.video}: ${r.error}`);
      });
  }

  if (successCount > 0) {
    console.log('\n✨ Subtitle generation and import completed!');
    console.log(`   Subtitles are now available in the video player.`);
  }

  // Close database connection
  await pool.end();

  process.exit(failCount > 0 ? 1 : 0);
}

// Run main function
main().catch(async (error) => {
  console.error('\n❌ Fatal error:', error);
  await pool.end();
  process.exit(1);
});


