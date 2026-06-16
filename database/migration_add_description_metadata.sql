-- Description metadata columns for VTT-based generation
-- Run: mysql -u root -p video_delivery < database/migration_add_description_metadata.sql

USE video_delivery;

ALTER TABLE videos
ADD COLUMN IF NOT EXISTS ai_status VARCHAR(20) DEFAULT 'pending'
  COMMENT 'pending|processing|done|failed';

ALTER TABLE videos
ADD COLUMN IF NOT EXISTS keywords TEXT NULL
  COMMENT 'JSON array of SEO keywords';

ALTER TABLE videos
ADD COLUMN IF NOT EXISTS tags TEXT NULL
  COMMENT 'JSON array of topic tags';
