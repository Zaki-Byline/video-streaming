#!/usr/bin/env node

/**
 * Check which videos can have AI descriptions generated.
 * Usage: npm run check-media
 */

import '../config/loadEnv.js';
import pool from '../config/database.js';
import { resolveVttPath } from '../utils/vttUtils.js';
import { resolveLocalVideoPath } from '../utils/videoPathResolver.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAPTIONS_DIR = path.join(__dirname, '../../video-storage/captions');
const MY_STORAGE_DIR = path.join(__dirname, '../../video-storage/my-storage');

const [videos] = await pool.execute(`
  SELECT id, video_id, title, redirect_slug, file_path, description
  FROM videos
  WHERE status != 'deleted'
  ORDER BY id DESC
`);

let ready = 0;
let canGenerate = 0;
let missing = 0;
const missingList = [];
const readyList = [];

for (const video of videos) {
  const vtt = await resolveVttPath(video.video_id);
  const local = resolveLocalVideoPath(video);

  if (vtt) {
    ready++;
    if (!video.description?.trim()) readyList.push(video);
  } else if (local) {
    canGenerate++;
  } else {
    missing++;
    if (!video.description?.trim()) missingList.push(video);
  }
}

const vttOnDisk = fs.existsSync(CAPTIONS_DIR)
  ? fs.readdirSync(CAPTIONS_DIR).filter((f) => f.endsWith('.vtt')).length
  : 0;
const mp4OnDisk = fs.existsSync(MY_STORAGE_DIR)
  ? fs.readdirSync(MY_STORAGE_DIR).filter((f) => f.endsWith('.mp4')).length
  : 0;

console.log('\n=== Media readiness for AI descriptions ===\n');
console.log(`Videos in DB:        ${videos.length}`);
console.log(`VTT ready:           ${ready} (subtitle file on disk)`);
console.log(`Can auto-subtitle:   ${canGenerate} (local .mp4 found, no VTT yet)`);
console.log(`Missing media:       ${missing} (no VTT and no local video)`);
console.log(`VTT files on disk:   ${vttOnDisk} in video-storage/captions/`);
console.log(`MP4 files on disk:   ${mp4OnDisk} in video-storage/my-storage/`);

if (readyList.length > 0) {
  console.log(`\n✅ Can generate descriptions now (${readyList.length}):`);
  readyList.slice(0, 10).forEach((v) => console.log(`   #${v.id} ${v.video_id} — ${v.title}`));
}

if (missingList.length > 0) {
  console.log(`\n❌ Cannot generate — restore files first (${missingList.length}):`);
  missingList.slice(0, 10).forEach((v) => {
    console.log(`   #${v.id} ${v.video_id} slug=${v.redirect_slug}`);
    console.log(`      Expected video: video-storage/my-storage/${v.redirect_slug}.mp4`);
    console.log(`      Expected VTT:   video-storage/captions/${v.video_id}_en.vtt`);
  });
  console.log('\nFix options:');
  console.log('  1. Re-upload videos via Admin → Video Upload');
  console.log('  2. Copy files from production/cPanel server into video-storage/');
  console.log('  3. Then run: npm run generate-and-import-all (if only video exists, no VTT)');
}

console.log('');
await pool.end();
process.exit(missingList.length > 0 && readyList.length === 0 ? 1 : 0);
