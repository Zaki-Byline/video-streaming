#!/usr/bin/env node

/**
 * Check Subtitle Status for All Videos
 * 
 * Shows which videos have subtitles and which don't
 */

import pool from '../config/database.js';
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUBTITLES_DIR = path.join(__dirname, '../subtitles');
const CAPTIONS_DIR = path.join(__dirname, '../../video-storage/captions');

async function main() {
  console.log('📊 Checking Subtitle Status...\n');
  console.log('='.repeat(70));
  
  // Get all videos
  const [videos] = await pool.execute('SELECT video_id, title FROM videos ORDER BY created_at DESC');
  const [cloudflareResources] = await pool.execute('SELECT file_name, cloudflare_key FROM cloudflare_resources ORDER BY created_at DESC');
  const [captions] = await pool.execute('SELECT video_id, language, file_path FROM captions');
  
  // Get files
  const subtitleFiles = existsSync(SUBTITLES_DIR) ? readdirSync(SUBTITLES_DIR).filter(f => f.endsWith('.vtt')) : [];
  const captionFiles = existsSync(CAPTIONS_DIR) ? readdirSync(CAPTIONS_DIR).filter(f => f.endsWith('.vtt')) : [];
  
  console.log(`\n📹 Videos in database: ${videos.length}`);
  console.log(`📦 Cloudflare resources: ${cloudflareResources.length}`);
  console.log(`📝 Captions in database: ${captions.length}`);
  console.log(`📁 Subtitle files (temp): ${subtitleFiles.length}`);
  console.log(`📁 Caption files (final): ${captionFiles.length}`);
  
  // Create maps
  const videosWithCaptions = new Set(captions.map(c => c.video_id));
  const captionFileVideoIds = new Set(captionFiles.map(f => f.replace('_en.vtt', '').replace('.vtt', '')));
  
  console.log('\n' + '='.repeat(70));
  console.log('📋 Videos WITHOUT Captions:');
  console.log('='.repeat(70));
  
  let missingCount = 0;
  for (const video of videos) {
    if (!videosWithCaptions.has(video.video_id)) {
      console.log(`   ❌ ${video.video_id} - ${video.title || 'No title'}`);
      missingCount++;
    }
  }
  
  if (missingCount === 0) {
    console.log('   ✅ All videos have captions!');
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('📋 Cloudflare Resources WITHOUT Captions:');
  console.log('='.repeat(70));
  
  let cloudflareMissingCount = 0;
  for (const resource of cloudflareResources) {
    // Try to extract video ID from filename or cloudflare_key
    const fileName = resource.file_name || '';
    const cloudflareKey = resource.cloudflare_key || '';
    
    // Try to find video ID pattern
    const videoIdMatch = fileName.match(/^(VID[^_]+)/) || cloudflareKey.match(/VID[^_\/]+/);
    if (videoIdMatch) {
      const potentialVideoId = videoIdMatch[0];
      if (!videosWithCaptions.has(potentialVideoId) && !captionFileVideoIds.has(potentialVideoId)) {
        console.log(`   ❌ ${potentialVideoId} - ${fileName}`);
        cloudflareMissingCount++;
      }
    }
  }
  
  if (cloudflareMissingCount === 0) {
    console.log('   ✅ All Cloudflare resources have captions!');
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('📊 Summary:');
  console.log(`   Videos missing captions: ${missingCount}`);
  console.log(`   Cloudflare resources missing captions: ${cloudflareMissingCount}`);
  console.log('='.repeat(70));
  
  if (missingCount > 0 || cloudflareMissingCount > 0) {
    console.log('\n💡 To generate missing subtitles, run:');
    console.log('   npm run generate-and-import-all');
  }
  
  await pool.end();
}

main().catch(async (error) => {
  console.error('\n❌ Error:', error);
  await pool.end();
  process.exit(1);
});


