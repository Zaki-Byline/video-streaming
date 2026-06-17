import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';
import { getCaptionsByVideoId } from '../services/captionService.js';
import {
  resolveCoLocatedVttAbsolute,
  vttPathForVideoPath
} from './vttLifecycle.js';
import { resolveLocalVideoPath } from './videoPathResolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CAPTIONS_DIR = path.join(__dirname, '../../video-storage/captions');
const SUBTITLES_DIR = path.join(__dirname, '../../subtitles');
const BACKEND_SUBTITLES_DIR = path.join(__dirname, '../subtitles');

function pathExists(p) {
  return p && fs.existsSync(p);
}

/**
 * Resolve VTT path: co-located beside video first, then DB, then legacy folders.
 */
export async function resolveVttPath(videoId) {
  const [videoRows] = await pool.execute(
    'SELECT video_id, file_path, redirect_slug FROM videos WHERE video_id = ? LIMIT 1',
    [videoId]
  );
  const video = videoRows[0];

  if (video) {
    const coLocated = resolveCoLocatedVttAbsolute(video);
    if (coLocated) return coLocated;

    const mp4 = resolveLocalVideoPath(video);
    if (mp4) {
      const paired = vttPathForVideoPath(mp4);
      if (pathExists(paired)) return paired;
    }
  }

  try {
    const captions = await getCaptionsByVideoId(videoId);
    for (const caption of captions) {
      const roots = [
        path.join(__dirname, '../../video-storage', caption.file_path),
        path.join(__dirname, '..', caption.file_path),
        path.join(__dirname, '../..', caption.file_path)
      ];
      for (const fromDb of roots) {
        if (pathExists(fromDb)) return fromDb;
      }
    }
  } catch {
    // fall through
  }

  const candidates = [
    path.join(CAPTIONS_DIR, `${videoId}_en.vtt`),
    path.join(CAPTIONS_DIR, `${videoId}.vtt`),
    path.join(SUBTITLES_DIR, `${videoId}.vtt`),
    path.join(BACKEND_SUBTITLES_DIR, `${videoId}.vtt`)
  ];

  for (const candidate of candidates) {
    if (pathExists(candidate)) return candidate;
  }

  return null;
}

export function getVttPath(videoId) {
  return null;
}

const TIMESTAMP_LINE = /^\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}/;

export function extractText(vttContent) {
  if (!vttContent) return '';

  return vttContent
    .replace(/^WEBVTT[^\n]*\n?/im, '')
    .replace(/NOTE\s+[\s\S]*?(?=\n\n|\n\d|$)/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^\d+$/.test(line)) return false;
      if (TIMESTAMP_LINE.test(line)) return false;
      if (line.startsWith('NOTE')) return false;
      return true;
    })
    .map((line) => line.replace(/<[^>]+>/g, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Load plain transcript text from a video's VTT file (for admin display / AI input).
 */
export async function getSubtitleTranscriptForVideo(videoId, maxLength = 4000) {
  const vttPath = await resolveVttPath(videoId);
  if (!vttPath) return null;

  const { isVttValid } = await import('./vttLifecycle.js');
  if (!(await isVttValid(vttPath))) return null;

  const content = await fsPromises.readFile(vttPath, 'utf8');
  const text = extractText(content);
  if (!text) return null;

  if (maxLength > 0 && text.length > maxLength) {
    return `${text.slice(0, maxLength)}…`;
  }
  return text;
}
