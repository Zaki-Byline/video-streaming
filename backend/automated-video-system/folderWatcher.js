#!/usr/bin/env node

/**
 * Folder Watcher for Automatic Subtitle Generation
 * 
 * Watches the upload/ folder for new video files and automatically
 * generates subtitles when a new video is detected.
 * 
 * Usage:
 *   node folderWatcher.js
 * 
 * This script runs independently and monitors the upload folder.
 * When a new video file is added, it automatically generates subtitles.
 */

import { watch } from 'fs';
import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateSubtitles } from '../utils/subtitleGenerator.js';
import { ensureDirectoryExists } from '../utils/fileUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths - relative to project root
// __dirname = backend/automated-video-system
// Go up two levels to project root, then into upload/ and subtitles/
const UPLOAD_DIR = path.join(__dirname, '../../upload');
const SUBTITLES_DIR = path.join(__dirname, '../../subtitles');

// Track processed files to avoid duplicate processing
const processedFiles = new Set();

// Ensure directories exist
ensureDirectoryExists(UPLOAD_DIR);
ensureDirectoryExists(SUBTITLES_DIR);

/**
 * Check if file is a video file
 */
function isVideoFile(filename) {
  return /\.(mp4|webm|ogg|mov|avi)$/i.test(filename);
}

/**
 * Get all existing video files
 */
function getExistingVideos() {
  if (!existsSync(UPLOAD_DIR)) {
    return [];
  }

  const files = readdirSync(UPLOAD_DIR);
  return files
    .filter(file => isVideoFile(file))
    .map(file => path.join(UPLOAD_DIR, file));
}

/**
 * Process a video file (generate subtitles)
 */
async function processVideo(videoPath) {
  const videoName = path.basename(videoPath);
  const videoNameWithoutExt = path.basename(videoName, path.extname(videoName));
  const subtitlePath = path.join(SUBTITLES_DIR, `${videoNameWithoutExt}.vtt`);

  // Skip if already processed or subtitle exists
  if (processedFiles.has(videoPath) || existsSync(subtitlePath)) {
    return;
  }

  console.log(`\n📹 New video detected: ${videoName}`);
  console.log(`   Path: ${videoPath}`);

  try {
    // Wait a bit to ensure file is fully written
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check file size to ensure it's not still being written
    const stats = statSync(videoPath);
    if (stats.size === 0) {
      console.log(`   ⚠️  File appears to be empty, skipping...`);
      return;
    }

    console.log(`\n🎤 Generating subtitles for ${videoName}...`);
    console.log(`   This may take several minutes depending on video length...`);

    await generateSubtitles(videoPath, {
      outputPath: subtitlePath,
      model: 'base',
      language: null // Auto-detect language
    });

    console.log(`✅ Subtitles generated successfully!`);
    console.log(`   Subtitle file: ${subtitlePath}`);

    // Mark as processed
    processedFiles.add(videoPath);
  } catch (error) {
    console.error(`❌ Error generating subtitles for ${videoName}:`, error.message);
    // Don't mark as processed so it can be retried
  }
}

/**
 * Watch folder for new files
 */
function startWatcher() {
  console.log('\n' + '='.repeat(60));
  console.log('👀 Folder Watcher Started');
  console.log('='.repeat(60));
  console.log(`📁 Watching folder: ${UPLOAD_DIR}`);
  console.log(`📝 Subtitles will be saved to: ${SUBTITLES_DIR}`);
  console.log('='.repeat(60));
  console.log('\n💡 The watcher will automatically generate subtitles for new videos.');
  console.log('   Press Ctrl+C to stop.\n');

  // Mark existing videos as processed (don't regenerate subtitles for them)
  const existingVideos = getExistingVideos();
  existingVideos.forEach(videoPath => {
    processedFiles.add(videoPath);
  });

  if (existingVideos.length > 0) {
    console.log(`📋 Found ${existingVideos.length} existing video(s) - these will not be processed.`);
    console.log('   To regenerate subtitles, delete the .vtt file and restart the watcher.\n');
  }

  // Watch the upload directory
  watch(UPLOAD_DIR, { recursive: false }, async (eventType, filename) => {
    if (!filename || !isVideoFile(filename)) {
      return;
    }

    const videoPath = path.join(UPLOAD_DIR, filename);

    // Only process new files (not deletions or modifications)
    if (eventType === 'rename' && existsSync(videoPath)) {
      // Small delay to ensure file is fully written
      setTimeout(async () => {
        if (existsSync(videoPath)) {
          await processVideo(videoPath);
        }
      }, 1000);
    }
  });

  console.log('✅ Watcher is now active. Waiting for new videos...\n');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Stopping folder watcher...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n👋 Stopping folder watcher...');
  process.exit(0);
});

// Start the watcher
startWatcher();


