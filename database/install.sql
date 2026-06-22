-- =============================================================================
-- video_delivery — Full Production Install Script
-- Run this ONCE on a fresh database to set up everything.
-- Safe to run on an existing DB (uses IF NOT EXISTS / IF EXISTS guards).
-- =============================================================================

CREATE DATABASE IF NOT EXISTS video_delivery
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE video_delivery;

-- =============================================================================
-- TABLE: videos
-- =============================================================================
CREATE TABLE IF NOT EXISTS videos (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  video_id       VARCHAR(100)  NOT NULL UNIQUE,
  partner_id     VARCHAR(100)  NULL,
  subject        VARCHAR(255)  NULL,           -- renamed from 'course'
  title          VARCHAR(255)  NULL,
  grade          VARCHAR(255)  NULL,
  unit           VARCHAR(255)  NULL,
  lesson         VARCHAR(255)  NULL,
  module         VARCHAR(255)  NULL,
  activity       VARCHAR(255)  NULL,
  topic          VARCHAR(255)  NULL,
  description    TEXT          NULL,
  keywords       TEXT          NULL            COMMENT 'JSON array of SEO keywords',
  tags           TEXT          NULL            COMMENT 'JSON array of topic tags',
  language       VARCHAR(10)   DEFAULT 'en',
  file_path      VARCHAR(500)  NOT NULL,
  streaming_url  VARCHAR(500)  NOT NULL,
  qr_url         VARCHAR(500)  NULL,
  thumbnail_url  VARCHAR(500)  NULL            COMMENT 'Path to video thumbnail image',
  redirect_slug  VARCHAR(100)  NOT NULL UNIQUE,
  duration       INT           DEFAULT 0       COMMENT 'Duration in seconds',
  size           BIGINT        DEFAULT 0       COMMENT 'File size in bytes',
  version        INT           DEFAULT 1,
  status         ENUM('active','inactive','deleted') DEFAULT 'active',
  ai_status      VARCHAR(20)   DEFAULT 'pending' COMMENT 'pending|processing|done|failed',
  created_at     TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_video_id        (video_id),
  INDEX idx_partner_id      (partner_id),
  INDEX idx_subject         (subject),
  INDEX idx_grade_unit_lesson (grade, unit, lesson),
  INDEX idx_module          (module),
  INDEX idx_activity        (activity),
  INDEX idx_status          (status),
  INDEX idx_ai_status       (ai_status),
  INDEX idx_redirect_slug   (redirect_slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- TABLE: admins
-- =============================================================================
CREATE TABLE IF NOT EXISTS admins (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  username           VARCHAR(100)  NOT NULL UNIQUE,
  full_name          VARCHAR(255)  NULL,
  password_hash      VARCHAR(255)  NOT NULL,
  email              VARCHAR(255)  NULL,
  role               VARCHAR(50)   DEFAULT 'viewer'  COMMENT 'admin | uploader | viewer',
  can_upload_videos  BOOLEAN       DEFAULT FALSE      COMMENT 'Permission to upload videos',
  can_view_videos    BOOLEAN       DEFAULT FALSE      COMMENT 'Permission to view videos',
  can_check_links    BOOLEAN       DEFAULT FALSE      COMMENT 'Permission to check redirect links',
  can_check_qr_codes BOOLEAN       DEFAULT FALSE      COMMENT 'Permission to check QR codes',
  is_active          BOOLEAN       DEFAULT TRUE       COMMENT 'Whether the account is active',
  created_by         INT           NULL,
  last_login         TIMESTAMP     NULL,
  created_at         TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_admins_role   (role),
  INDEX idx_admins_active (is_active),
  INDEX idx_admins_email  (email),
  CONSTRAINT fk_created_by FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- TABLE: captions
-- =============================================================================
CREATE TABLE IF NOT EXISTS captions (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  video_id   VARCHAR(100) NOT NULL,
  language   VARCHAR(10)  NOT NULL,
  file_path  VARCHAR(500) NOT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY unique_video_language (video_id, language),
  INDEX idx_captions_video_id (video_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- TABLE: redirects
-- =============================================================================
CREATE TABLE IF NOT EXISTS redirects (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  slug       VARCHAR(100) NOT NULL UNIQUE,
  target_url VARCHAR(500) NOT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- TABLE: video_versions
-- =============================================================================
CREATE TABLE IF NOT EXISTS video_versions (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  video_id   VARCHAR(100) NOT NULL,
  version    INT          NOT NULL,
  file_path  VARCHAR(500) NOT NULL,
  size       BIGINT       DEFAULT 0,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY unique_video_version (video_id, version),
  INDEX idx_video_versions_video_id (video_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- TABLE: video_replacements
-- =============================================================================
CREATE TABLE IF NOT EXISTS video_replacements (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  redirect_slug VARCHAR(100) NOT NULL,
  old_video_id  VARCHAR(100) NOT NULL,
  new_video_id  VARCHAR(100) NOT NULL,
  old_file_path VARCHAR(500) NULL,
  new_file_path VARCHAR(500) NULL,
  replaced_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  replaced_by   VARCHAR(100) NULL,
  notes         TEXT         NULL,

  INDEX idx_vr_redirect_slug (redirect_slug),
  INDEX idx_vr_old_video_id  (old_video_id),
  INDEX idx_vr_new_video_id  (new_video_id),
  INDEX idx_vr_replaced_at   (replaced_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- TABLE: cloudflare_resources
-- =============================================================================
CREATE TABLE IF NOT EXISTS cloudflare_resources (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  file_name           VARCHAR(500)  NOT NULL,
  original_file_name  VARCHAR(500)  NOT NULL,
  file_size           BIGINT        NOT NULL,
  file_type           VARCHAR(100)  NULL,
  cloudflare_url      VARCHAR(1000) NOT NULL,
  cloudflare_key      VARCHAR(500)  NOT NULL,
  storage_type        ENUM('r2','stream')              DEFAULT 'r2',
  source_type         ENUM('local','misc','upload')    DEFAULT 'upload',
  source_path         VARCHAR(1000) NULL,
  status              ENUM('uploading','completed','failed') DEFAULT 'completed',
  created_at          TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_cf_key        (cloudflare_key),
  INDEX idx_cf_file_name  (file_name),
  INDEX idx_cf_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- TABLE: csv_upload_history
-- =============================================================================
CREATE TABLE IF NOT EXISTS csv_upload_history (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  file_name         VARCHAR(500) NOT NULL,
  file_size         BIGINT       NULL,
  total_videos      INT          DEFAULT 0,
  successful_videos INT          DEFAULT 0,
  failed_videos     INT          DEFAULT 0,
  status            ENUM('processing','completed','failed') DEFAULT 'processing',
  error_message     TEXT         NULL,
  uploaded_by       VARCHAR(100) NULL,
  created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_csv_status     (status),
  INDEX idx_csv_created_at (created_at),
  INDEX idx_csv_uploaded_by (uploaded_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- TABLE: analytics
-- =============================================================================
CREATE TABLE IF NOT EXISTS analytics (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  video_id   VARCHAR(100) NOT NULL,
  event_type VARCHAR(50)  NOT NULL,
  user_id    VARCHAR(100) NULL,
  session_id VARCHAR(100) NULL,
  metadata   JSON         NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_analytics_video_id   (video_id),
  INDEX idx_analytics_event_type (event_type),
  INDEX idx_analytics_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- DEFAULT ADMIN USER
-- password: admin123  (bcrypt hash — change after first login!)
-- To set a custom password run: node backend/scripts/createAdmin.js <user> <pass>
-- =============================================================================
INSERT INTO admins (
  username, password_hash, email, full_name, role,
  can_upload_videos, can_view_videos, can_check_links, can_check_qr_codes, is_active
)
VALUES (
  'admin',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',  -- password: admin123
  'admin@example.com',
  'Administrator',
  'admin',
  TRUE, TRUE, TRUE, TRUE, TRUE
)
ON DUPLICATE KEY UPDATE
  role               = 'admin',
  can_upload_videos  = TRUE,
  can_view_videos    = TRUE,
  can_check_links    = TRUE,
  can_check_qr_codes = TRUE,
  is_active          = TRUE;

-- =============================================================================
-- Done. Database video_delivery is ready.
-- =============================================================================
