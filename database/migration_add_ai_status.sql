-- Add AI description generation status to videos table
-- Run: mysql -u root -p video_delivery < database/migration_add_ai_status.sql

USE video_delivery;

ALTER TABLE videos
ADD COLUMN IF NOT EXISTS ai_status VARCHAR(20) DEFAULT 'pending'
  COMMENT 'pending|processing|done|failed';

-- updated_at already exists on videos; ensure it auto-updates on row changes
ALTER TABLE videos
MODIFY COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
