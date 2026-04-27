#!/usr/bin/env node

/**
 * Cleanup Unused Subtitle Files
 * 
 * This script:
 * 1. Checks which videos exist in the database
 * 2. Checks which captions exist in the database
 * 3. Removes unused subtitle files from backend/subtitles/ (temp files)
 * 4. Keeps only files that are actually used in video-storage/captions/
 */

import { readdirSync, existsSync, unlinkSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const SUBTITLES_DIR = path.join(__dirname, '../subtitles');
const CAPTIONS_DIR = path.join(__dirname, '../../video-storage/captions');

/**
 * Get all videos from database
 */
async function getAllVideos() {
  try {
    const [rows] = await pool.execute('SELECT video_id FROM videos');
    return rows.map(row => row.video_id);
  } catch (error) {
    console.error('Error fetching videos:', error.message);
    return [];
  }
}

/**
 * Get all captions from database
 */
async function getAllCaptions() {
  try {
    const [rows] = await pool.execute('SELECT video_id, file_path FROM captions');
    return rows;
  } catch (error) {
    console.error('Error fetching captions:', error.message);
    return [];
  }
}

/**
 * Get all subtitle files in subtitles directory
 */
function getSubtitleFiles() {
  if (!existsSync(SUBTITLES_DIR)) {
    return [];
  }
  
  try {
    const files = readdirSync(SUBTITLES_DIR);
    return files
      .filter(file => file.endsWith('.vtt'))
      .map(file => ({
        filename: file,
        fullPath: path.join(SUBTITLES_DIR, file),
        videoId: file.replace('.vtt', '')
      }));
  } catch (error) {
    console.error('Error reading subtitles directory:', error.message);
    return [];
  }
}

/**
 * Get all caption files in captions directory
 */
function getCaptionFiles() {
  if (!existsSync(CAPTIONS_DIR)) {
    return [];
  }
  
  try {
    const files = readdirSync(CAPTIONS_DIR);
    return files
      .filter(file => file.endsWith('.vtt'))
      .map(file => ({
        filename: file,
        fullPath: path.join(CAPTIONS_DIR, file),
        videoId: file.replace('_en.vtt', '').replace('.vtt', '')
      }));
  } catch (error) {
    console.error('Error reading captions directory:', error.message);
    return [];
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🧹 Starting subtitle cleanup...\n');
  console.log('='.repeat(70));
  
  // Get data
  console.log('📊 Gathering data...');
  const videos = await getAllVideos();
  const captions = await getAllCaptions();
  const subtitleFiles = getSubtitleFiles();
  const captionFiles = getCaptionFiles();
  
  console.log(`   Videos in database: ${videos.length}`);
  console.log(`   Captions in database: ${captions.length}`);
  console.log(`   Subtitle files (temp): ${subtitleFiles.length}`);
  console.log(`   Caption files (final): ${captionFiles.length}`);
  
  // Create a set of video IDs that have captions
  const videosWithCaptions = new Set(captions.map(c => c.video_id));
  const captionFileVideoIds = new Set(captionFiles.map(f => f.videoId));
  
  console.log('\n📋 Analysis:');
  console.log(`   Videos with captions in DB: ${videosWithCaptions.size}`);
  console.log(`   Videos with caption files: ${captionFileVideoIds.size}`);
  
  // Find unused subtitle files
  // A subtitle file is unused if:
  // 1. The video has a caption file in video-storage/captions/ (already imported)
  // 2. OR the video doesn't exist in database
  const unusedSubtitles = subtitleFiles.filter(subtitle => {
    const videoId = subtitle.videoId;
    
    // If video has caption file, temp subtitle is no longer needed
    if (captionFileVideoIds.has(videoId)) {
      return true;
    }
    
    // If video doesn't exist in database, subtitle is orphaned
    if (!videos.includes(videoId)) {
      return true;
    }
    
    return false;
  });
  
  console.log(`\n🗑️  Unused subtitle files to remove: ${unusedSubtitles.length}`);
  
  if (unusedSubtitles.length === 0) {
    console.log('\n✅ No unused subtitle files found. Everything is clean!');
    await pool.end();
    process.exit(0);
  }
  
  // Show what will be deleted
  console.log('\n📝 Files to be removed:');
  unusedSubtitles.forEach(subtitle => {
    const size = existsSync(subtitle.fullPath) ? statSync(subtitle.fullPath).size : 0;
    const sizeKB = (size / 1024).toFixed(2);
    console.log(`   - ${subtitle.filename} (${sizeKB} KB)`);
  });
  
  // Delete unused files
  console.log('\n🗑️  Removing unused files...');
  let deletedCount = 0;
  let errorCount = 0;
  
  for (const subtitle of unusedSubtitles) {
    try {
      if (existsSync(subtitle.fullPath)) {
        unlinkSync(subtitle.fullPath);
        console.log(`   ✅ Deleted: ${subtitle.filename}`);
        deletedCount++;
      }
    } catch (error) {
      console.error(`   ❌ Error deleting ${subtitle.filename}:`, error.message);
      errorCount++;
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 Cleanup Summary:');
  console.log(`   Files deleted: ${deletedCount}`);
  console.log(`   Errors: ${errorCount}`);
  console.log(`   Remaining subtitle files: ${subtitleFiles.length - deletedCount}`);
  console.log('='.repeat(70));
  
  // Close database connection
  await pool.end();
  
  process.exit(errorCount > 0 ? 1 : 0);
}

// Run main function
main().catch(async (error) => {
  console.error('\n❌ Fatal error:', error);
  await pool.end();
  process.exit(1);
});


