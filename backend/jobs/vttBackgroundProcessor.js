/**
 * Startup background job: automatically generate missing VTT files and descriptions.
 * Scans periodically, processes in small batches, retries failed jobs after cooldown.
 */

import config from '../config/config.js';
import { processVttBatch } from '../services/vttProcessorService.js';

let scanTimer = null;
let isScanning = false;

function getSettings() {
  return {
    enabled: process.env.VTT_BACKGROUND_JOB !== 'false',
    scanIntervalMs: parseInt(process.env.VTT_SCAN_INTERVAL_MS, 10) || 60 * 1000,
    startupDelayMs: parseInt(process.env.VTT_STARTUP_DELAY_MS, 10) || 15 * 1000,
    batchSize: Math.max(1, parseInt(process.env.VTT_BATCH_SIZE, 10) || 1)
  };
}

async function runScan() {
  if (isScanning) {
    return;
  }

  isScanning = true;
  try {
    let totalProcessed = 0;
    let rounds = 0;
    const maxRoundsPerScan = 10;

    // Drain backlog in batches during each scan cycle (one video per batch by default).
    while (rounds < maxRoundsPerScan) {
      const result = await processVttBatch({ batchSize: getSettings().batchSize });
      if (result.processed === 0) {
        break;
      }

      totalProcessed += result.processed;
      rounds++;

      console.log(
        `[vttBackground] Batch: ${result.succeeded} ok, ${result.failed} failed, ` +
        `${result.remaining} remaining`
      );

      if (result.remaining === 0) {
        break;
      }
    }

    if (totalProcessed > 0) {
      console.log(`[vttBackground] Scan complete — processed ${totalProcessed} video(s)`);
    }
  } catch (error) {
    console.error('[vttBackground] Scan error:', error.message);
  } finally {
    isScanning = false;
  }
}

export function startVttBackgroundProcessor() {
  const settings = getSettings();

  if (!settings.enabled) {
    console.log('[vttBackground] Background VTT processor disabled (VTT_BACKGROUND_JOB=false)');
    return;
  }

  console.log(
    `[vttBackground] Starting processor (batch=${settings.batchSize}, ` +
    `scan=${settings.scanIntervalMs}ms, delay=${settings.startupDelayMs}ms)`
  );

  setTimeout(() => {
    console.log('[vttBackground] Initial scan for videos missing subtitles…');
    runScan();
  }, settings.startupDelayMs);

  scanTimer = setInterval(runScan, settings.scanIntervalMs);
}

export function stopVttBackgroundProcessor() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}
