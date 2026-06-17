import pool from '../config/database.js';
import { ensureDescriptionColumns } from '../utils/aiStatus.js';
import { hasVttFile } from '../utils/ensureVttForVideo.js';
import { getSubtitleDisplayStatus } from '../utils/subtitleStatus.js';
import { reconcileVideoAiStatus } from '../services/vttProcessorService.js';
import { isVideoInFlight } from '../utils/vttInFlight.js';
import { getSubtitleTranscriptForVideo } from '../utils/vttUtils.js';
import {
  parseVideoMetadataFilters,
  appendVideoMetadataFilters
} from '../utils/videoMetadataFilters.js';

const BULK_GENERATE_DELAY_MS = 1500;
const BULK_GENERATE_MAX = 50;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseListPagination(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.limit, 10) || DEFAULT_PAGE_SIZE));
  return { page, limit, offset: (page - 1) * limit };
}

async function buildFilteredVideosQuery(filters) {
  let query = `
    SELECT id, video_id, title, subject, grade, unit, lesson, module, version,
           description, description_source, updated_at, ai_status
    FROM videos
    WHERE status != 'deleted'
  `;
  let params = [];
  ({ query, params } = await appendVideoMetadataFilters(query, params, filters));
  return { query, params };
}

async function fetchVideosForDescriptionQuery(filters, pagination = null) {
  const { query, params } = await buildFilteredVideosQuery(filters);

  if (!pagination) {
    const limitedQuery = `${query} ORDER BY id DESC LIMIT ${BULK_GENERATE_MAX}`;
    const [rows] = await pool.execute(limitedQuery, params);
    return rows;
  }

  const countQuery = query.replace(/SELECT[\s\S]+?FROM/i, 'SELECT COUNT(*) as total FROM');
  const [countRows] = await pool.execute(countQuery, params);
  const total = countRows[0]?.total || 0;
  const { page, limit, offset } = pagination;
  const listQuery = `${query} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`;
  const [rows] = await pool.execute(listQuery, params);

  return {
    rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  };
}

async function enrichVideoRow(video) {
  const has_vtt = await hasVttFile(video.video_id);
  let ai_status = await reconcileVideoAiStatus(video);
  if (isVideoInFlight(video.id) && ai_status !== 'failed' && !has_vtt) {
    ai_status = 'processing';
  }
  const subtitle_text = has_vtt ? await getSubtitleTranscriptForVideo(video.video_id) : null;
  const isAiDescription = video.description_source === 'openai' || video.description_source === 'gemini';
  return {
    id: video.id,
    video_id: video.video_id,
    title: video.title,
    subject: video.subject || null,
    grade: video.grade || null,
    unit: video.unit || null,
    lesson: video.lesson || null,
    module: video.module || null,
    version: video.version ?? null,
    description: isAiDescription ? (video.description || '') : '',
    description_source: video.description_source || null,
    has_ai_description: isAiDescription,
    subtitle_text,
    updated_at: video.updated_at,
    ai_status,
    has_vtt,
    subtitle_status: getSubtitleDisplayStatus({ ai_status, has_vtt })
  };
}

export async function getVideosForDescriptionManager(req, res) {
  try {
    await ensureDescriptionColumns();

    const filters = parseVideoMetadataFilters(req.query);
    const listPagination = parseListPagination(req.query);
    const { rows, pagination } = await fetchVideosForDescriptionQuery(filters, listPagination);
    const videos = await Promise.all(rows.map(enrichVideoRow));

    res.json({ videos, pagination });
  } catch (error) {
    console.error('[VideoDescriptions] Failed to list videos:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
}

export async function updateVideoDescription(req, res) {
  return res.status(403).json({
    error: 'Manual description edits are disabled. Use Generate description (OpenAI) instead.'
  });
}

export async function deleteVideoDescription(req, res) {
  try {
    const { id } = req.params;

    await pool.execute(
      'UPDATE videos SET description = NULL, description_source = NULL WHERE id = ?',
      [id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[VideoDescriptions] Failed to delete description:', error);
    res.status(500).json({ error: 'Failed to delete description' });
  }
}

/** Bulk-generate AI descriptions for filtered videos (or explicit IDs). */
async function runBulkGenerationJob(rows, missingOnly) {
  const { generateAiDescriptionForVideo } = await import('../utils/generateAiDescription.js');

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const video = rows[i];
    const hasVtt = await hasVttFile(video.video_id);
    const isAi = video.description_source === 'openai' || video.description_source === 'gemini';

    if (!hasVtt) {
      skipped++;
      console.warn(`[VideoDescriptions] Bulk skip #${video.id} — no subtitles`);
      continue;
    }

    if (missingOnly && isAi && video.description?.trim()) {
      skipped++;
      continue;
    }

    try {
      await generateAiDescriptionForVideo(video);
      succeeded++;
      console.log(`[VideoDescriptions] Bulk OK #${video.id} ${video.video_id}`);
    } catch (error) {
      failed++;
      console.error(`[VideoDescriptions] Bulk fail #${video.id}:`, error.message);
    }

    if (i < rows.length - 1) {
      await sleep(BULK_GENERATE_DELAY_MS);
    }
  }

  console.log(
    `[VideoDescriptions] Bulk job finished: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped`
  );
}

export async function bulkGenerateDescriptions(req, res) {
  try {
    const filters = parseVideoMetadataFilters({ ...req.query, ...req.body?.filters });
    const missingOnly = req.body?.missingOnly !== false;
    const requestedIds = Array.isArray(req.body?.videoIds)
      ? req.body.videoIds.map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id))
      : null;

    let rows;
    if (requestedIds?.length) {
      const placeholders = requestedIds.map(() => '?').join(', ');
      const [idRows] = await pool.execute(
        `SELECT id, video_id, title, subject, grade, unit, lesson, module, version,
                description, description_source, updated_at, ai_status
         FROM videos
         WHERE status != 'deleted' AND id IN (${placeholders})
         ORDER BY id ASC`,
        requestedIds
      );
      rows = idRows;
    } else {
      rows = await fetchVideosForDescriptionQuery(filters);
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No videos match the current filters.' });
    }

    if (rows.length > BULK_GENERATE_MAX) {
      rows = rows.slice(0, BULK_GENERATE_MAX);
    }

    // Respond immediately — bulk AI calls can take many minutes and will reset the dev proxy.
    res.status(202).json({
      success: true,
      started: true,
      queued: rows.length,
      missingOnly,
      message: `Started generating descriptions for up to ${rows.length} video(s) in the background.`
    });

    runBulkGenerationJob(rows, missingOnly).catch((error) => {
      console.error('[VideoDescriptions] Background bulk job crashed:', error);
    });
  } catch (error) {
    console.error('[VideoDescriptions] Bulk generation failed:', error);
    res.status(500).json({ error: error.message || 'Bulk generation failed' });
  }
}

/** Generate description from VTT transcript via OpenAI (Video Library action). */
export async function generateAiDescription(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute('SELECT * FROM videos WHERE id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const { generateAiDescriptionForVideo } = await import('../utils/generateAiDescription.js');
    const result = await generateAiDescriptionForVideo(rows[0]);

    res.json({
      success: true,
      description: result.description
    });
  } catch (error) {
    console.error('[VideoDescriptions] AI description generation failed:', error);
    res.status(500).json({
      error: error.message || 'Failed to generate description'
    });
  }
}
