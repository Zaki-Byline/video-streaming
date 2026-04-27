#!/usr/bin/env node

/**
 * Check Subtitle System Status
 * 
 * This script checks:
 * 1. If subtitle files exist in backend/subtitles/
 * 2. If caption files exist in video-storage/captions/
 * 3. If database entries exist in captions table
 * 4. If videos exist in videos table
 * 5. Tests caption file accessibility
 * 
 * Usage:
 *   node scripts/checkSubtitleSystem.js [videoId]
 */

import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const SUBTITLES_DIR = path.join(__dirname, '../subtitles');
const CAPTIONS_DIR = path.join(__dirname, '../../video-storage/captions');

const videoId = process.argv[2] || null;

/**
 * Check subtitle files in backend/subtitles/
 */
function checkSubtitleFiles() {
  console.log('\n📁 Checking subtitle files in backend/subtitles/...');
  
  if (!existsSync(SUBTITLES_DIR)) {
    console.log('   ❌ Directory does not exist:', SUBTITLES_DIR);
    return [];
  }

  const files = readdirSync(SUBTITLES_DIR);
  const vttFiles = files.filter(f => f.toLowerCase().endsWith('.vtt'));
  
  if (vttFiles.length === 0) {
    console.log('   ⚠️  No .vtt files found');
    return [];
  }

  console.log(`   ✅ Found ${vttFiles.length} .vtt file(s):`);
  vttFiles.slice(0, 10).forEach(file => {
    console.log(`      - ${file}`);
  });
  if (vttFiles.length > 10) {
    console.log(`      ... and ${vttFiles.length - 10} more`);
  }

  return vttFiles.map(f => path.basename(f, '.vtt'));
}

/**
 * Check caption files in video-storage/captions/
 */
function checkCaptionFiles() {
  console.log('\n📁 Checking caption files in video-storage/captions/...');
  
  if (!existsSync(CAPTIONS_DIR)) {
    console.log('   ❌ Directory does not exist:', CAPTIONS_DIR);
    return [];
  }

  const files = readdirSync(CAPTIONS_DIR);
  const vttFiles = files.filter(f => f.toLowerCase().endsWith('.vtt'));
  
  if (vttFiles.length === 0) {
    console.log('   ⚠️  No .vtt files found');
    return [];
  }

  console.log(`   ✅ Found ${vttFiles.length} .vtt file(s):`);
  vttFiles.slice(0, 10).forEach(file => {
    console.log(`      - ${file}`);
  });
  if (vttFiles.length > 10) {
    console.log(`      ... and ${vttFiles.length - 10} more`);
  }

  return vttFiles;
}

/**
 * Check database entries
 */
async function checkDatabaseEntries(videoIdFilter = null) {
  console.log('\n💾 Checking database entries...');
  
  try {
    let query = 'SELECT * FROM captions';
    let params = [];
    
    if (videoIdFilter) {
      query += ' WHERE video_id = ?';
      params.push(videoIdFilter);
    }
    
    query += ' ORDER BY video_id, language LIMIT 20';
    
    const [rows] = await pool.execute(query, params);
    
    if (rows.length === 0) {
      console.log('   ⚠️  No caption entries found in database');
      return [];
    }

    console.log(`   ✅ Found ${rows.length} caption entry/entries:`);
    rows.forEach(row => {
      console.log(`      - video_id: ${row.video_id}, language: ${row.language}, file_path: ${row.file_path}`);
    });

    return rows;
  } catch (error) {
    console.error('   ❌ Database error:', error.message);
    return [];
  }
}

/**
 * Check if video exists in database
 */
async function checkVideo(videoId) {
  console.log(`\n🎥 Checking video: ${videoId}...`);
  
  try {
    const [rows] = await pool.execute(
      'SELECT video_id, title, status FROM videos WHERE video_id = ?',
      [videoId]
    );
    
    if (rows.length === 0) {
      console.log('   ❌ Video not found in database');
      return null;
    }

    const video = rows[0];
    console.log(`   ✅ Video found:`);
    console.log(`      - Title: ${video.title}`);
    console.log(`      - Status: ${video.status}`);
    
    return video;
  } catch (error) {
    console.error('   ❌ Database error:', error.message);
    return null;
  }
}

/**
 * Check caption for specific video
 */
async function checkVideoCaption(videoId) {
  console.log(`\n📝 Checking captions for video: ${videoId}...`);
  
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM captions WHERE video_id = ?',
      [videoId]
    );
    
    if (rows.length === 0) {
      console.log('   ⚠️  No caption entries found for this video');
      return [];
    }

    console.log(`   ✅ Found ${rows.length} caption(s):`);
    rows.forEach(row => {
      const captionPath = path.join(CAPTIONS_DIR, `${row.video_id}_${row.language}.vtt`);
      const fileExists = existsSync(captionPath);
      
      console.log(`      - Language: ${row.language}`);
      console.log(`         File path (DB): ${row.file_path}`);
      console.log(`         File exists: ${fileExists ? '✅' : '❌'} (${captionPath})`);
    });

    return rows;
  } catch (error) {
    console.error('   ❌ Database error:', error.message);
    return [];
  }
}

/**
 * Test caption URL accessibility
 */
function testCaptionUrl(videoId, language = 'en') {
  console.log(`\n🌐 Testing caption URL...`);
  
  const backendUrl = process.env.API_URL || 'http://localhost:5000';
  const captionUrl = `${backendUrl}/video-storage/captions/${videoId}_${language}.vtt`;
  
  console.log(`   URL: ${captionUrl}`);
  console.log(`   💡 Test this URL in your browser or use:`);
  console.log(`      curl "${captionUrl}"`);
}

/**
 * Main function
 */
async function main() {
  console.log('🔍 Subtitle System Diagnostic Tool');
  console.log('='.repeat(60));

  if (videoId) {
    // Check specific video
    const video = await checkVideo(videoId);
    if (video) {
      await checkVideoCaption(videoId);
      testCaptionUrl(videoId);
    }
  } else {
    // General check
    const subtitleVideoIds = checkSubtitleFiles();
    const captionFiles = checkCaptionFiles();
    const dbEntries = await checkDatabaseEntries();

    console.log('\n' + '='.repeat(60));
    console.log('📊 Summary:');
    console.log(`   Subtitle files (backend/subtitles/): ${subtitleVideoIds.length}`);
    console.log(`   Caption files (video-storage/captions/): ${captionFiles.length}`);
    console.log(`   Database entries: ${dbEntries.length}`);
    
    if (subtitleVideoIds.length > 0 && captionFiles.length === 0) {
      console.log('\n💡 Tip: Run "npm run import-subtitles" to import subtitle files to caption system');
    }
  }

  await pool.end();
}

// Run main function
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});


