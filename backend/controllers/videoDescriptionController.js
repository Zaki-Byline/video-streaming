import pool from '../config/database.js';
import { ensureDescriptionColumns } from '../utils/generateDescriptionFromVtt.js';
import { hasVttFile } from '../utils/ensureVttForVideo.js';
import { ensureVttFromVideo } from '../utils/vttLifecycle.js';
import { resolveLocalVideoPath } from '../utils/videoPathResolver.js';

export async function getVideosForDescriptionManager(req, res) {
  try {
    await ensureDescriptionColumns();

    const search = (req.query.search || '').trim();
    let query = `
      SELECT id, video_id, title, description, updated_at
      FROM videos
      WHERE status != 'deleted'
    `;
    const params = [];

    if (search) {
      query += ` AND (title LIKE ? OR video_id LIKE ? OR description LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    query += ` ORDER BY id DESC LIMIT 500`;

    const [rows] = await pool.execute(query, params);

    const videos = await Promise.all(rows.map(async (video) => ({
      id: video.id,
      video_id: video.video_id,
      title: video.title,
      description: video.description,
      updated_at: video.updated_at,
      has_vtt: await hasVttFile(video.video_id)
    })));

    res.json(videos);
  } catch (error) {
    console.error('[VideoDescriptions] Failed to list videos:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
}

export async function updateVideoDescription(req, res) {
  try {
    const { description } = req.body;
    const { id } = req.params;

    await ensureDescriptionColumns();
    await pool.execute(
      'UPDATE videos SET description = ? WHERE id = ?',
      [description ?? '', id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[VideoDescriptions] Failed to update description:', error);
    res.status(500).json({ error: 'Failed to update description' });
  }
}

export async function deleteVideoDescription(req, res) {
  try {
    const { id } = req.params;

    await pool.execute(
      'UPDATE videos SET description = NULL WHERE id = ?',
      [id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[VideoDescriptions] Failed to delete description:', error);
    res.status(500).json({ error: 'Failed to delete description' });
  }
}

/** Generate Whisper subtitles + fill description from VTT text (when upload async failed). */
export async function generateSubtitlesForVideo(req, res) {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute('SELECT * FROM videos WHERE id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const video = rows[0];
    const mp4 = resolveLocalVideoPath(video);

    if (!mp4) {
      return res.status(400).json({ error: `Video file not found for ${video.video_id}` });
    }

    await ensureVttFromVideo(video);

    const [updated] = await pool.execute(
      'SELECT description FROM videos WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      has_vtt: true,
      description: updated[0]?.description || ''
    });
  } catch (error) {
    console.error('[VideoDescriptions] Subtitle generation failed:', error);
    res.status(500).json({ error: error.message || 'Subtitle generation failed' });
  }
}
