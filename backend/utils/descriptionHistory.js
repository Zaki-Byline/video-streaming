import pool from '../config/database.js';

/**
 * Ensure the description_history table exists.
 * Called lazily on first history read/write — no startup overhead.
 */
export async function ensureHistoryTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS description_history (
      id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      video_id      INT UNSIGNED NOT NULL,
      description   TEXT,
      source        VARCHAR(50),
      changed_by    VARCHAR(100) DEFAULT 'system',
      changed_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_video_id (video_id),
      INDEX idx_changed_at (changed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

/**
 * Save a snapshot of the current description BEFORE overwriting it.
 * @param {number} videoId  - numeric DB id
 * @param {string|null} description
 * @param {string|null} source
 * @param {string} changedBy
 */
export async function recordHistory(videoId, description, source, changedBy = 'system') {
  await ensureHistoryTable();
  if (!description?.trim()) return; // don't store empty snapshots
  await pool.execute(
    `INSERT INTO description_history (video_id, description, source, changed_by, changed_at)
     VALUES (?, ?, ?, ?, NOW())`,
    [videoId, description, source || null, changedBy]
  );
}

/**
 * Fetch history entries for a video, newest first.
 */
export async function getHistory(videoId, limit = 20) {
  await ensureHistoryTable();
  const [rows] = await pool.execute(
    `SELECT id, video_id, description, source, changed_by, changed_at
     FROM description_history
     WHERE video_id = ?
     ORDER BY changed_at DESC
     LIMIT ?`,
    [videoId, limit]
  );
  return rows;
}
