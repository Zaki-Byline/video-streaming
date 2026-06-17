#!/usr/bin/env node

/**
 * Process all videos missing VTT subtitles (and descriptions).
 * Same logic as the server startup background job — run manually for bulk backfill.
 *
 * Usage:
 *   npm run generate-missing-vtt
 *   node scripts/generateMissingVttAndDescriptions.js
 *   node scripts/generateMissingVttAndDescriptions.js --all   # drain entire backlog in one run
 */

import '../config/loadEnv.js';
import pool from '../config/database.js';
import { findVideosNeedingVtt, processVttBatch } from '../services/vttProcessorService.js';

const drainAll = process.argv.includes('--all');
const batchSize = Math.max(1, parseInt(process.env.VTT_BATCH_SIZE, 10) || 1);

async function main() {
  console.log('[generateMissingVtt] Scanning videos…\n');

  const candidates = await findVideosNeedingVtt();
  console.log(`Found ${candidates.length} video(s) needing subtitles\n`);

  if (candidates.length === 0) {
    await pool.end();
    process.exit(0);
  }

  let totalSucceeded = 0;
  let totalFailed = 0;
  let rounds = 0;

  do {
    const result = await processVttBatch({ batchSize, forceDescription: true });
    if (result.processed === 0) break;

    totalSucceeded += result.succeeded;
    totalFailed += result.failed;
    rounds++;
    console.log(
      `Round ${rounds}: ${result.succeeded} ok, ${result.failed} failed, ${result.remaining} remaining\n`
    );
  } while (drainAll && rounds < 1000);

  console.log('=== Summary ===');
  console.log(`succeeded: ${totalSucceeded}`);
  console.log(`failed:    ${totalFailed}`);

  await pool.end();
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[generateMissingVtt] Fatal:', err);
  process.exit(1);
});
