/**
 * Track AI pipeline status (subtitle + description generation) on videos.ai_status.
 * Values: pending | processing | done | failed
 */

import pool from '../config/database.js';

/**
 * Ensure ai_status, keywords, tags columns exist.
 */
export async function ensureDescriptionColumns() {
  const columns = [
    { name: 'ai_status', ddl: "VARCHAR(20) DEFAULT 'pending' COMMENT 'pending|processing|done|failed'" },
    { name: 'keywords', ddl: 'TEXT NULL COMMENT \'JSON array of SEO keywords\'' },
    { name: 'tags', ddl: 'TEXT NULL COMMENT \'JSON array of topic tags\'' },
    { name: 'description_source', ddl: "VARCHAR(20) NULL COMMENT 'openai|null — only openai descriptions are shown in admin UI'" }
  ];

  for (const col of columns) {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS count FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'videos' AND COLUMN_NAME = ?`,
      [col.name]
    );
    if (rows[0].count === 0) {
      await pool.execute(`ALTER TABLE videos ADD COLUMN ${col.name} ${col.ddl}`);
    }
  }
}

export async function setAiStatus(videoDbId, status) {
  if (!videoDbId) return;
  await ensureDescriptionColumns();
  await pool.execute('UPDATE videos SET ai_status = ? WHERE id = ?', [status, videoDbId]);
}
