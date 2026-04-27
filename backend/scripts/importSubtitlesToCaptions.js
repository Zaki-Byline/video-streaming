#!/usr/bin/env node

/**
 * Import Subtitle Files to Caption System
 * 
 * This script:
 * 1. Scans backend/subtitles/ for .vtt files
 * 2. Moves them to video-storage/captions/ with correct naming (videoId_language.vtt)
 * 3. Adds entries to the captions database table
 * 
 * Usage:
 *   node scripts/importSubtitlesToCaptions.js [options]
 * 
 * Options:
 *   --language, -l  Language code (default: en)
 *   --dry-run       Show what would be done without making changes
 */

import { existsSync, readdirSync, mkdirSync } from 'fs';
import { copyFile, unlink, access } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';
import { ensureDirectoryExists } from '../utils/fileUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const SUBTITLES_DIR = path.join(__dirname, '../subtitles');
const CAPTIONS_DIR = path.join(__dirname, '../../video-storage/captions');

// Parse command line arguments
const args = process.argv.slice(2);
let language = 'en';
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--language' || arg === '-l') {
    language = args[++i] || 'en';
  } else if (arg === '--dry-run') {
    dryRun = true;
  }
}

/**
 * Get all .vtt files from subtitles directory
 */
function getSubtitleFiles() {
  if (!existsSync(SUBTITLES_DIR)) {
    console.error(`❌ Subtitles directory not found: ${SUBTITLES_DIR}`);
    return [];
  }

  const files = readdirSync(SUBTITLES_DIR);
  const vttFiles = files
    .filter(file => file.toLowerCase().endsWith('.vtt'))
    .map(file => ({
      filename: file,
      fullPath: path.join(SUBTITLES_DIR, file),
      videoId: path.basename(file, '.vtt')
    }));

  return vttFiles;
}

/**
 * Check if video exists in database
 */
async function videoExists(videoId) {
  try {
    const [rows] = await pool.execute(
      'SELECT video_id FROM videos WHERE video_id = ?',
      [videoId]
    );
    return rows.length > 0;
  } catch (error) {
    console.error(`Error checking video ${videoId}:`, error.message);
    return false;
  }
}

/**
 * Check if caption already exists in database
 */
async function captionExists(videoId, lang) {
  try {
    const [rows] = await pool.execute(
      'SELECT id FROM captions WHERE video_id = ? AND language = ?',
      [videoId, lang]
    );
    return rows.length > 0;
  } catch (error) {
    console.error(`Error checking caption ${videoId}/${lang}:`, error.message);
    return false;
  }
}

/**
 * Import a single subtitle file
 */
async function importSubtitle(subtitle, lang) {
  const { videoId, fullPath, filename } = subtitle;
  
  // Check if video exists
  const exists = await videoExists(videoId);
  if (!exists) {
    console.warn(`   ⚠️  Video ${videoId} not found in database, skipping...`);
    return { success: false, videoId, reason: 'Video not in database' };
  }

  // Check if caption already exists
  const captionExistsInDb = await captionExists(videoId, lang);
  if (captionExistsInDb) {
    console.log(`   ⏭️  Caption already exists for ${videoId} (${lang}), skipping...`);
    return { success: false, videoId, reason: 'Caption already exists' };
  }

  // Target paths
  const targetFilename = `${videoId}_${lang}.vtt`;
  const targetPath = path.join(CAPTIONS_DIR, targetFilename);
  const relativePath = `captions/${targetFilename}`;

  if (dryRun) {
    console.log(`   [DRY RUN] Would import: ${filename}`);
    console.log(`            → ${targetPath}`);
    console.log(`            → Database: video_id=${videoId}, language=${lang}, file_path=${relativePath}`);
    return { success: true, videoId, dryRun: true };
  }

  try {
    // Ensure captions directory exists
    await ensureDirectoryExists(CAPTIONS_DIR);

    // Copy file to captions directory
    await copyFile(fullPath, targetPath);
    console.log(`   ✅ Copied: ${filename} → ${targetPath}`);

    // Add to database
    const query = `
      INSERT INTO captions (video_id, language, file_path)
      VALUES (?, ?, ?)
    `;
    await pool.execute(query, [videoId, lang, relativePath]);
    console.log(`   ✅ Added to database: ${videoId} (${lang})`);

    return { success: true, videoId, targetPath, relativePath };
  } catch (error) {
    console.error(`   ❌ Error importing ${filename}:`, error.message);
    return { success: false, videoId, error: error.message };
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Starting subtitle import to caption system...\n');
  console.log('='.repeat(60));
  console.log('Configuration:');
  console.log(`   Subtitles folder: ${SUBTITLES_DIR}`);
  console.log(`   Captions folder: ${CAPTIONS_DIR}`);
  console.log(`   Language: ${language}`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will make changes)'}`);
  console.log('='.repeat(60));

  // Check if subtitles directory exists
  if (!existsSync(SUBTITLES_DIR)) {
    console.error(`\n❌ Subtitles directory not found: ${SUBTITLES_DIR}`);
    console.error('   Please run the subtitle generation script first.');
    process.exit(1);
  }

  // Get all subtitle files
  console.log('\n📂 Scanning for subtitle files...');
  const subtitleFiles = getSubtitleFiles();

  if (subtitleFiles.length === 0) {
    console.log('   ⚠️  No .vtt files found in subtitles folder');
    process.exit(0);
  }

  console.log(`   ✅ Found ${subtitleFiles.length} subtitle file(s)\n`);

  // Process each subtitle file
  const results = [];
  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (let i = 0; i < subtitleFiles.length; i++) {
    const subtitle = subtitleFiles[i];
    console.log(`\n[${i + 1}/${subtitleFiles.length}] Processing: ${subtitle.filename}`);
    
    const result = await importSubtitle(subtitle, language);
    results.push(result);
    
    if (result.success && !result.dryRun) {
      successCount++;
    } else if (result.reason === 'Caption already exists' || result.reason === 'Video not in database') {
      skipCount++;
    } else {
      failCount++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary:');
  console.log(`   Total files: ${subtitleFiles.length}`);
  console.log(`   ✅ Imported: ${successCount}`);
  console.log(`   ⏭️  Skipped: ${skipCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log('='.repeat(60));

  if (failCount > 0) {
    console.log('\n❌ Failed imports:');
    results
      .filter(r => !r.success && r.error)
      .forEach(r => {
        console.log(`   - ${r.videoId}: ${r.error}`);
      });
  }

  if (successCount > 0 || dryRun) {
    console.log('\n✨ Import completed!');
    if (!dryRun) {
      console.log(`   Captions saved to: ${CAPTIONS_DIR}`);
      console.log(`   Database entries created in 'captions' table`);
    }
  }

  // Close database connection
  await pool.end();

  process.exit(failCount > 0 ? 1 : 0);
}

// Run main function
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});


