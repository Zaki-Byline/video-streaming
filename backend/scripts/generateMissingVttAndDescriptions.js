#!/usr/bin/env node

/**
 * Generate VTT subtitles for DB videos that have a local MP4 but no caption file.
 * Then generate descriptions from the new VTT files.
 *
 * Usage:
 *   npm run generate-missing-vtt
 *   node scripts/generateMissingVttAndDescriptions.js
 */

import '../config/loadEnv.js';
import pool from '../config/database.js';
import { resolveVttPath } from '../utils/vttUtils.js';
import { resolveLocalVideoPath } from '../utils/videoPathResolver.js';
import { generateVttFromVideo } from '../utils/vttLifecycle.js';
import { generateDescriptionFromVtt } from '../utils/generateDescriptionFromVtt.js';

async function main() {
  console.log('[generateMissingVtt] Scanning videos…\n');

  const [videos] = await pool.execute(
    `SELECT id, video_id, title, redirect_slug, file_path
     FROM videos WHERE status != 'deleted' ORDER BY id ASC`
  );

  let processed = 0;
  let vttCreated = 0;
  let descCreated = 0;
  let failed = 0;

  for (const video of videos) {
    const existingVtt = await resolveVttPath(video.video_id);
    if (existingVtt) {
      continue;
    }

    const mp4Path = resolveLocalVideoPath(video);
    if (!mp4Path) {
      console.warn(`⏭️  #${video.id} ${video.video_id} — no MP4, skipping`);
      continue;
    }

    processed++;
    console.log(`\n🎬 #${video.id} ${video.video_id}`);
    console.log(`   MP4: ${mp4Path}`);

    try {
      console.log('   → Extracting audio + transcribing…');
      const vttPath = await generateVttFromVideo(video, mp4Path, { replace: true });
      vttCreated++;
      console.log(`   ✅ VTT saved beside video: ${vttPath}`);

      const metadata = await generateDescriptionFromVtt(video, { vttPath });
      descCreated++;
      console.log(`   ✅ Description: ${metadata.description.slice(0, 80)}…`);
    } catch (error) {
      failed++;
      console.error(`   ❌ Failed: ${error.message}`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`videos processed: ${processed}`);
  console.log(`vtt created:      ${vttCreated}`);
  console.log(`descriptions:     ${descCreated}`);
  console.log(`failed:           ${failed}`);

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[generateMissingVtt] Fatal:', err);
  process.exit(1);
});
