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
import { recordHistory, getHistory } from '../utils/descriptionHistory.js';

const BULK_GENERATE_DELAY_MS = 4000;
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
           description, description_source, updated_at, ai_status, created_at
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
    created_at: video.created_at || null,
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

export async function getVideoDescriptionById(req, res) {
  try {
    const { videoId } = req.params;

    const isNumeric = /^\d+$/.test(videoId);
    const whereClause = isNumeric ? 'id = ?' : 'video_id = ?';
    const lookupValue = isNumeric ? parseInt(videoId, 10) : videoId;

    const [rows] = await pool.execute(
      `SELECT id, video_id, title, subject, grade, unit, lesson, module, version,
              description, description_source, updated_at, created_at, ai_status
       FROM videos
       WHERE ${whereClause} AND status != 'deleted'
       LIMIT 1`,
      [lookupValue]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const video = rows[0];
    const subtitle_text = await getSubtitleTranscriptForVideo(video.video_id);

    res.json({
      id: video.id,
      videoId: video.video_id,
      title: video.title || '',
      subject: video.subject || '',
      grade: video.grade || '',
      unit: video.unit || '',
      lesson: video.lesson || '',
      module: video.module || '',
      version: video.version || '',
      transcript: subtitle_text || '',
      description: video.description || '',
      descriptionSource: video.description_source || null,
      updatedAt: video.updated_at,
      createdAt: video.created_at || null,
    });
  } catch (error) {
    console.error('[VideoDescriptions] getVideoDescriptionById failed:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch video description' });
  }
}

export async function getVideoDescriptionHistory(req, res) {
  try {
    const { videoId } = req.params;
    const isNumeric = /^\d+$/.test(videoId);
    const whereClause = isNumeric ? 'id = ?' : 'video_id = ?';
    const lookupValue = isNumeric ? parseInt(videoId, 10) : videoId;

    const [rows] = await pool.execute(
      `SELECT id FROM videos WHERE ${whereClause} AND status != 'deleted' LIMIT 1`,
      [lookupValue]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const history = await getHistory(rows[0].id, 30);
    res.json({ history });
  } catch (error) {
    console.error('[VideoDescriptions] getVideoDescriptionHistory failed:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch history' });
  }
}

export async function updateVideoDescription(req, res) {
  try {
    const videoId = req.params.videoId || req.params.id;
    const { description, updatedBy } = req.body;

    if (description === undefined) {
      return res.status(400).json({ error: 'No description field provided' });
    }

    const isNumeric = /^\d+$/.test(videoId);
    const whereClause = isNumeric ? 'id = ?' : 'video_id = ?';
    const lookupValue = isNumeric ? parseInt(videoId, 10) : videoId;

    const [existing] = await pool.execute(
      `SELECT id, video_id, description, description_source FROM videos WHERE ${whereClause} AND status != 'deleted' LIMIT 1`,
      [lookupValue]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const video = existing[0];

    // Archive current description before overwriting
    await recordHistory(video.id, video.description, video.description_source, updatedBy || 'admin');

    // Preserve existing source; set to 'manual' only for brand-new text; clear when emptying
    const newSource = description?.trim()
      ? (video.description_source || 'manual')
      : null;

    await pool.execute(
      `UPDATE videos SET description = ?, description_source = ?, updated_at = NOW() WHERE id = ?`,
      [description || null, newSource, video.id]
    );

    console.log(`[VideoDescriptions] Updated #${video.id} by ${updatedBy || 'unknown'}`);
    res.json({ success: true, id: video.id, videoId: video.video_id });
  } catch (error) {
    console.error('[VideoDescriptions] updateVideoDescription failed:', error);
    res.status(500).json({ error: error.message || 'Failed to update description' });
  }
}

export async function restoreVideoDescriptionVersion(req, res) {
  try {
    const { videoId, historyId } = req.params;
    const { restoredBy } = req.body;

    const isNumeric = /^\d+$/.test(videoId);
    const whereClause = isNumeric ? 'id = ?' : 'video_id = ?';
    const lookupValue = isNumeric ? parseInt(videoId, 10) : videoId;

    const [videoRows] = await pool.execute(
      `SELECT id, video_id, description, description_source FROM videos WHERE ${whereClause} AND status != 'deleted' LIMIT 1`,
      [lookupValue]
    );
    if (videoRows.length === 0) return res.status(404).json({ error: 'Video not found' });
    const video = videoRows[0];

    const [histRows] = await pool.execute(
      `SELECT * FROM description_history WHERE id = ? AND video_id = ? LIMIT 1`,
      [parseInt(historyId, 10), video.id]
    );
    if (histRows.length === 0) return res.status(404).json({ error: 'History entry not found' });
    const hist = histRows[0];

    // Archive current before restoring
    await recordHistory(video.id, video.description, video.description_source, restoredBy || 'admin');

    await pool.execute(
      `UPDATE videos SET description = ?, description_source = ?, updated_at = NOW() WHERE id = ?`,
      [hist.description, hist.source, video.id]
    );

    console.log(`[VideoDescriptions] Restored #${video.id} to history entry ${historyId}`);
    res.json({ success: true, description: hist.description, source: hist.source });
  } catch (error) {
    console.error('[VideoDescriptions] restoreVideoDescriptionVersion failed:', error);
    res.status(500).json({ error: error.message || 'Failed to restore version' });
  }
}

export async function deleteVideoDescription(req, res) {
  try {
    const { id } = req.params;
    const [existing] = await pool.execute(
      `SELECT id, description, description_source FROM videos WHERE id = ? LIMIT 1`,
      [parseInt(id, 10)]
    );
    if (existing.length > 0) {
      await recordHistory(existing[0].id, existing[0].description, existing[0].description_source, 'admin');
    }
    await pool.execute(
      'UPDATE videos SET description = NULL, description_source = NULL, updated_at = NOW() WHERE id = ?',
      [parseInt(id, 10)]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('[VideoDescriptions] Failed to delete description:', error);
    res.status(500).json({ error: 'Failed to delete description' });
  }
}

export async function exportDescriptions(req, res) {
  try {
    const { videoIds } = req.body;
    let rows;

    if (Array.isArray(videoIds) && videoIds.length > 0) {
      const placeholders = videoIds.map(() => '?').join(', ');
      const [r] = await pool.execute(
        `SELECT id, video_id, title, subject, grade, unit, lesson, module, version,
                description, description_source, updated_at
         FROM videos WHERE id IN (${placeholders}) AND status != 'deleted' ORDER BY id ASC`,
        videoIds.map((id) => parseInt(id, 10))
      );
      rows = r;
    } else {
      const filters = parseVideoMetadataFilters(req.query);
      rows = await fetchVideosForDescriptionQuery(filters);
    }

    const csv = [
      ['ID', 'Video ID', 'Title', 'Subject', 'Grade', 'Unit', 'Lesson', 'Module', 'Version', 'Description', 'Source', 'Updated At'].join(','),
      ...rows.map((r) => [
        r.id,
        r.video_id,
        `"${(r.title || '').replace(/"/g, '""')}"`,
        r.subject || '',
        r.grade || '',
        r.unit || '',
        r.lesson || '',
        r.module || '',
        r.version || '',
        `"${(r.description || '').replace(/"/g, '""')}"`,
        r.description_source || '',
        r.updated_at ? new Date(r.updated_at).toISOString() : ''
      ].join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="descriptions-${Date.now()}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('[VideoDescriptions] exportDescriptions failed:', error);
    res.status(500).json({ error: error.message || 'Export failed' });
  }
}

export async function bulkClearDescriptions(req, res) {
  try {
    const { videoIds } = req.body;
    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return res.status(400).json({ error: 'videoIds array required' });
    }
    const ids = videoIds.map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id));
    const placeholders = ids.map(() => '?').join(', ');

    // Archive each before clearing
    const [rows] = await pool.execute(
      `SELECT id, description, description_source FROM videos WHERE id IN (${placeholders})`,
      ids
    );
    for (const row of rows) {
      await recordHistory(row.id, row.description, row.description_source, 'admin-bulk');
    }

    await pool.execute(
      `UPDATE videos SET description = NULL, description_source = NULL, updated_at = NOW()
       WHERE id IN (${placeholders})`,
      ids
    );

    res.json({ success: true, cleared: ids.length });
  } catch (error) {
    console.error('[VideoDescriptions] bulkClearDescriptions failed:', error);
    res.status(500).json({ error: error.message || 'Bulk clear failed' });
  }
}

/** Bulk-generate AI descriptions for filtered videos (or explicit IDs). */
async function runBulkGenerationJob(rows, missingOnly) {
  const { generateAiDescriptionForVideo } = await import('../utils/generateAiDescription.js');
  let succeeded = 0, failed = 0, skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const video = rows[i];
    const hasVtt = await hasVttFile(video.video_id);
    const isAi = video.description_source === 'openai' || video.description_source === 'gemini';

    if (!hasVtt) { skipped++; continue; }
    if (missingOnly && isAi && video.description?.trim()) { skipped++; continue; }

    try {
      await generateAiDescriptionForVideo(video);
      succeeded++;
    } catch (error) {
      failed++;
      console.error(`[VideoDescriptions] Bulk fail #${video.id}:`, error.message);
    }
    if (i < rows.length - 1) await sleep(BULK_GENERATE_DELAY_MS);
  }
  console.log(`[VideoDescriptions] Bulk done: ${succeeded} ok, ${failed} fail, ${skipped} skip`);
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
         FROM videos WHERE status != 'deleted' AND id IN (${placeholders}) ORDER BY id ASC`,
        requestedIds
      );
      rows = idRows;
    } else {
      rows = await fetchVideosForDescriptionQuery(filters);
    }

    if (rows.length === 0) return res.status(400).json({ error: 'No videos match.' });
    if (rows.length > BULK_GENERATE_MAX) rows = rows.slice(0, BULK_GENERATE_MAX);

    res.status(202).json({
      success: true, started: true, queued: rows.length, missingOnly,
      message: `Started generating descriptions for up to ${rows.length} video(s) in the background.`
    });

    runBulkGenerationJob(rows, missingOnly).catch((e) =>
      console.error('[VideoDescriptions] Background bulk job crashed:', e)
    );
  } catch (error) {
    console.error('[VideoDescriptions] Bulk generation failed:', error);
    res.status(500).json({ error: error.message || 'Bulk generation failed' });
  }
}

export async function generateAiDescription(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute('SELECT * FROM videos WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Video not found' });

    const { generateAiDescriptionForVideo } = await import('../utils/generateAiDescription.js');
    const result = await generateAiDescriptionForVideo(rows[0]);

    res.json({ success: true, description: result.description });
  } catch (error) {
    console.error('[VideoDescriptions] AI description generation failed:', error);
    res.status(500).json({ error: error.message || 'Failed to generate description' });
  }
}
