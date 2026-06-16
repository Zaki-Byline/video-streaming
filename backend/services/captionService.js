import pool from '../config/database.js';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureDirectoryExists } from '../utils/fileUtils.js';
import {
  resolveCoLocatedVttAbsolute,
  relativePathForCoLocatedVtt,
  saveVttBesideVideo,
  deleteVttForVideo
} from '../utils/vttLifecycle.js';
import { resolveLocalVideoPath } from '../utils/videoPathResolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CAPTIONS_DIR = path.join(__dirname, '../../video-storage/captions');
const VIDEO_STORAGE_ROOT = path.join(__dirname, '../../video-storage');

function resolveCaptionFileOnDisk(caption, videoId) {
  const paths = [];

  if (caption.file_path) {
    if (caption.file_path.startsWith('upload/')) {
      paths.push(path.join(__dirname, '..', caption.file_path));
    }
    paths.push(path.join(VIDEO_STORAGE_ROOT, caption.file_path));
    paths.push(path.join(__dirname, '..', caption.file_path));
    paths.push(path.join(__dirname, '../..', caption.file_path));
  }

  paths.push(path.join(CAPTIONS_DIR, `${videoId}_${caption.language}.vtt`));
  paths.push(path.join(CAPTIONS_DIR, path.basename(caption.file_path || '')));

  for (const p of paths) {
    if (p && fsSync.existsSync(p)) return p;
  }
  return null;
}

/**
 * Upload caption file — saves co-located beside video when possible, else legacy captions/.
 */
export async function uploadCaption(videoId, language, fileBuffer, filename) {
  try {
    const [videoRows] = await pool.execute(
      'SELECT video_id, file_path FROM videos WHERE video_id = ? LIMIT 1',
      [videoId]
    );
    const video = videoRows[0];
    const mp4 = video ? resolveLocalVideoPath(video) : null;

    if (mp4) {
      const saved = await saveVttBesideVideo(videoId, mp4, fileBuffer);
      return saved.relativePath;
    }

    await ensureDirectoryExists(CAPTIONS_DIR);
    const captionPath = path.join(CAPTIONS_DIR, `${videoId}_${language}.vtt`);
    await fs.writeFile(captionPath, fileBuffer);
    const relativePath = `captions/${videoId}_${language}.vtt`;

    await pool.execute(
      `INSERT INTO captions (video_id, language, file_path)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE file_path = ?`,
      [videoId, language, relativePath, relativePath]
    );

    return relativePath;
  } catch (error) {
    console.error('Error uploading caption:', error);
    throw error;
  }
}

/**
 * Get captions for a video (DB rows + co-located VTT fallback).
 */
export async function getCaptionsByVideoId(videoId) {
  const query = 'SELECT * FROM captions WHERE video_id = ?';
  const [rows] = await pool.execute(query, [videoId]);

  if (rows.length > 0) {
    return rows;
  }

  const [videoRows] = await pool.execute(
    'SELECT video_id, file_path, redirect_slug FROM videos WHERE video_id = ? LIMIT 1',
    [videoId]
  );
  const video = videoRows[0];
  if (!video) return rows;

  const coLocated = resolveCoLocatedVttAbsolute(video);
  if (!coLocated) return rows;

  const mp4 = resolveLocalVideoPath(video);
  const relativePath = mp4
    ? relativePathForCoLocatedVtt(mp4)
    : path.basename(coLocated);

  return [{
    video_id: videoId,
    language: 'en',
    file_path: relativePath
  }];
}

/**
 * Delete caption by ID
 */
export async function deleteCaption(id) {
  const query = 'SELECT * FROM captions WHERE id = ?';
  const [rows] = await pool.execute(query, [id]);

  if (rows.length > 0) {
    const caption = rows[0];
    const diskPath = resolveCaptionFileOnDisk(caption, caption.video_id);

    if (diskPath) {
      try {
        await fs.unlink(diskPath);
      } catch (error) {
        console.error('Error deleting caption file:', error);
      }
    }

    const deleteQuery = 'DELETE FROM captions WHERE id = ?';
    const [result] = await pool.execute(deleteQuery, [id]);
    return result.affectedRows > 0;
  }

  return false;
}

/**
 * Delete all captions for a video (co-located VTT, legacy paths, DB rows).
 */
export async function deleteCaptionsByVideoId(videoId) {
  try {
    const [videoRows] = await pool.execute(
      'SELECT video_id, file_path, redirect_slug FROM videos WHERE video_id = ? LIMIT 1',
      [videoId]
    );
    const video = videoRows[0] || { video_id: videoId };

    const result = await deleteVttForVideo(video);
    return { deleted: result.captionsDeleted || 0, filesDeleted: result.filesDeleted };
  } catch (error) {
    console.error(`[deleteCaptionsByVideoId] Error deleting captions for video ${videoId}:`, error);
    throw error;
  }
}
