# Video Streaming Platform — Project Documentation

A full-stack educational video delivery platform with React frontend, Node.js/Express backend, and MySQL database. Supports video upload, streaming, QR codes, short URLs, captions, versioning, bulk import, Cloudflare storage, and Moodle embed mode.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Project Structure](#project-structure)
4. [Tech Stack](#tech-stack)
5. [Features](#features)
6. [Frontend](#frontend)
7. [Backend API](#backend-api)
8. [Database](#database)
9. [File Storage](#file-storage)
10. [Authentication & Authorization](#authentication--authorization)
11. [Video Streaming](#video-streaming)
12. [Automated Video System](#automated-video-system)
13. [Backend Scripts](#backend-scripts)
14. [Setup & Running](#setup--running)
15. [Configuration](#configuration)
16. [Deployment Notes](#deployment-notes)

---

## Overview

This system is designed for **educational video delivery** — organizing content by grade/course/module/lesson, generating shareable short links and QR codes, and providing admin tools for bulk operations, exports, and user management.

| Component | Default URL |
|-----------|-------------|
| Frontend (Vite) | `http://localhost:5173` |
| Backend API | `http://localhost:5000` |
| Automated subtitle system | `http://localhost:3001` |

**Default admin credentials** (change in production):

- Username: `admin`
- Password: `admin123`

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        React Frontend (Vite)                     │
│  Admin Dashboard │ Video Player │ Bulk Upload │ Exports       │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP / REST (Axios)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Node.js + Express Backend                      │
│  Controllers → Services → MySQL (mysql2 pool)                 │
│  Static: /video-storage, /qr-codes, /thumbnails, /subtitles     │
└────────────┬───────────────────────────────┬────────────────────┘
             │                               │
             ▼                               ▼
    ┌────────────────┐              ┌──────────────────┐
    │  MySQL Database │              │  File System      │
    │  video_delivery │              │  video-storage/   │
    └────────────────┘              │  qr-codes/        │
                                    │  subtitles/       │
                                    └──────────────────┘
```

**Request flow (public video playback):**

1. User visits `/video/:videoId` or short slug `/:slug`
2. Frontend fetches video metadata from `GET /api/videos/:videoId`
3. Player streams via `GET /api/videos/:videoId/stream` (range requests supported)
4. Captions loaded from `/video-storage/captions/` or `/subtitles/`

---

## Project Structure

```
video-streaming/
├── backend/                          # Node.js API server
│   ├── config/
│   │   ├── config.js                 # Environment-based configuration
│   │   └── database.js               # MySQL connection pool
│   ├── controllers/                  # HTTP request handlers
│   │   ├── authController.js
│   │   ├── videoController.js
│   │   ├── streamController.js
│   │   ├── captionController.js
│   │   ├── redirectController.js
│   │   ├── bulkUploadController.js
│   │   ├── thumbnailController.js
│   │   ├── cloudflareController.js
│   │   └── userController.js
│   ├── middleware/
│   │   └── auth.js                   # JWT authentication
│   ├── routes/                       # Express route definitions
│   ├── services/                     # Business logic layer
│   │   ├── videoService.js
│   │   ├── captionService.js
│   │   ├── redirectService.js
│   │   ├── qrCodeService.js
│   │   └── thumbnailService.js
│   ├── scripts/                      # CLI utilities & migrations
│   ├── automated-video-system/       # Standalone subtitle generator
│   ├── upload/                       # Direct video uploads
│   └── server.js                     # Entry point
│
├── frontend/                         # React + Vite SPA
│   ├── src/
│   │   ├── components/               # Reusable UI components
│   │   ├── pages/                    # Route-level page components
│   │   ├── services/api.js           # Axios API client
│   │   ├── utils/                    # Helpers (apiConfig, videojs plugins)
│   │   └── App.jsx                   # Router configuration
│   └── package.json
│
├── database/                         # Schema & migrations
│   ├── schema.sql                    # Base schema
│   ├── seed.sql                      # Default admin seed
│   └── migration_*.sql               # Incremental migrations
│
├── video-storage/                    # Video files & captions
│   ├── G{grade}/U{unit}/L{lesson}/     # Organized video paths
│   ├── captions/                     # VTT caption files
│   └── thumbnails/                   # Video thumbnails
│
├── qr-codes/                         # Generated QR code images
├── subtitles/                        # Auto-generated subtitles (Whisper)
├── html5-custom-video-player-main/   # Reference HTML5 player assets
├── README.md                         # Quick start guide
├── SETUP.md                          # Step-by-step setup
└── PROJECT.md                        # This file
```

---

## Tech Stack

### Backend

| Package | Purpose |
|---------|---------|
| Express 4 | HTTP server & routing |
| mysql2 | MySQL database driver |
| multer | Multipart file uploads |
| jsonwebtoken + bcryptjs | JWT auth & password hashing |
| qrcode | QR code image generation |
| sharp | Image/thumbnail processing |
| csv-parse | Bulk CSV import |
| cors | Cross-origin requests |
| dotenv | Environment variables |

### Frontend

| Package | Purpose |
|---------|---------|
| React 18 + Vite 5 | UI framework & build tool |
| React Router 6 | Client-side routing |
| Tailwind CSS 3 | Styling |
| Axios | HTTP client |
| Video.js 8 + HLS plugins | Video playback |
| hls.js, react-player | Alternative players |
| lucide-react | Icons |
| qrcode.react, html2canvas, jspdf, jszip | QR & export utilities |

### Database

- **MySQL 8.0+** with InnoDB, utf8mb4

---

## Features

### Core

- Video upload with automatic folder organization and ID generation
- HTTP range-request streaming (seek support)
- QR code generation per video
- Short redirect URLs (`redirect_slug`) for sharing
- Video versioning (replace file, keep history)
- VTT caption upload and playback
- Soft delete with trash/restore and permanent delete
- View count tracking

### Admin

- Dashboard with statistics (totals, size, duration, captions, thumbnails)
- Video list with filters (grade, course, module, lesson, status)
- Bulk CSV upload with upload history
- CSV export (full and filtered)
- HTML embed code export (for LMS/Moodle)
- QR code storage and download
- Redirect URL management
- User management with role-based permissions
- Cloudflare / My Storage resource manager
- Video metadata diagnostics and quick-fix tools
- Thumbnail management

### Public

- Public video pages with Video.js player
- Dedicated stream page (`/stream/:videoId`)
- Embed mode (`?embed=true`) for Moodle/LMS
- Short URL resolution via frontend slug route
- Stream diagnostic page

### Integrations

- CDN-ready URL building (`USE_CDN` flag)
- Cloudflare R2/Stream resource tracking
- Moodle embed support
- Production domains configured in CORS (e.g. `kodeit-videos.legatolxp.online`, `qr.kodeit.online`)

---

## Frontend

### Routes (`frontend/src/App.jsx`)

| Path | Page | Auth |
|------|------|------|
| `/` | Redirects to `/admin/login` | — |
| `/video/:videoId` | Public video page | Public |
| `/stream/:videoId` | Stream-focused player page | Public |
| `/diagnostic` | Stream diagnostic | Public |
| `/diagnostic/:videoId` | Per-video diagnostic | Public |
| `/admin/login` | Admin login | Public |
| `/admin` | Admin dashboard | Protected |
| `/admin/bulk-upload` | Bulk CSV upload | Protected |
| `/admin/videos` | Active video list | Protected |
| `/admin/videos/inactive` | Inactive videos | Protected |
| `/admin/videos/:id/edit` | Edit video metadata | Protected |
| `/admin/qr-codes` | QR code storage | Protected |
| `/admin/trash` | Deleted videos (trash) | Protected |
| `/admin/csv-export` | CSV export tool | Protected |
| `/admin/html-embed-export` | HTML embed export | Protected |
| `/admin/cloudflare` | My Storage / Cloudflare manager | Protected |
| `/admin/redirects` | Redirect URL viewer | Protected |
| `/admin/users` | User management | Protected |
| `/admin/captions/:videoId` | Caption upload | Protected |
| `/admin/versions/:videoId` | Version history | Protected |
| `/:slug` | Short URL redirect handler | Public |

### Key Components

| Component | Description |
|-----------|-------------|
| `Layout.jsx` | App shell with navbar |
| `Sidebar.jsx` | Admin navigation sidebar |
| `ProtectedRoute.jsx` | JWT gate for admin routes |
| `VideoPlayer.jsx` | Full Video.js player |
| `SimpleVideoPlayer.jsx` | Lightweight player |
| `QRCodeViewer.jsx` | QR code display |
| `VideoDiagnostic.jsx` | Video health checks |
| `VideoReplacementDiagnostic.jsx` | Pre-replace validation |

### API Client

`frontend/src/services/api.js` — Axios instance with:

- Auto-attached `Authorization: Bearer <token>` from `localStorage`
- FormData content-type handling for uploads
- 401 redirect to `/admin/login`

---

## Backend API

### Health & Root

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/` | API info & endpoint list |

### Authentication (`/api/auth`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | — | Login, returns JWT |
| GET | `/api/auth/verify` | JWT | Verify token validity |

### Videos (`/api/videos`)

#### Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/videos` | List videos (pagination, filters) |
| GET | `/api/videos/filters` | Available filter values |
| GET | `/api/videos/:videoId` | Video details by ID |
| GET | `/api/videos/:videoId/stream` | Stream video (range requests) |
| GET | `/api/videos/:videoId/diagnostic` | Video diagnostic info |
| GET | `/api/videos/redirect-info/:slug` | Resolve short slug to video |
| POST | `/api/videos/:videoId/increment-views` | Increment view count |

#### Protected (JWT required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/videos/by-id/:id` | Get video by database ID |
| POST | `/api/videos/upload` | Upload video (+ optional thumbnail) |
| POST | `/api/videos/bulk-upload` | Bulk import from CSV |
| GET | `/api/videos/upload-history` | CSV upload history |
| DELETE | `/api/videos/upload-history/:id` | Delete upload history entry |
| DELETE | `/api/videos/upload-history` | Bulk delete upload history |
| PUT | `/api/videos/:id` | Update video metadata |
| DELETE | `/api/videos/:id` | Soft delete video |
| POST | `/api/videos/:id/restore` | Restore from trash |
| DELETE | `/api/videos/:id/permanent` | Permanently delete one video |
| POST | `/api/videos/permanent-delete` | Bulk permanent delete |
| POST | `/api/videos/:id/replace-video` | Replace video file |
| GET | `/api/videos/:id/replace-diagnostic` | Check replace eligibility |
| GET | `/api/videos/:videoId/versions` | Version history |
| GET | `/api/videos/:videoId/qr-download` | Download QR code |
| GET | `/api/videos/deleted` | List trashed videos |
| GET | `/api/videos/qr-codes` | All QR codes |
| GET | `/api/videos/misc-videos` | Miscellaneous video files |
| GET | `/api/videos/thumbnails` | Thumbnail listing |
| GET | `/api/videos/thumbnails/diagnostic` | Thumbnail diagnostics |
| GET | `/api/videos/export-csv` | Export all videos CSV |
| GET | `/api/videos/export-filtered-csv` | Export filtered CSV |
| GET | `/api/videos/export-html-embeds` | Export HTML embed codes |
| POST | `/api/videos/backfill-durations` | Backfill missing durations |
| GET | `/api/videos/diagnostic/:id` | Metadata diagnostic |
| POST | `/api/videos/diagnostic/:id/quick-fix` | Quick-fix metadata |

### Captions (`/api/captions`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/captions/:videoId` | — | List captions for video |
| POST | `/api/captions/upload` | JWT | Upload VTT caption |
| DELETE | `/api/captions/:id` | JWT | Delete caption |

### Admin (`/api/admin`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/admin/redirects` | JWT | List all redirects |
| DELETE | `/api/admin/redirects/:slug` | JWT | Delete redirect |

### Users (`/api/users`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/users` | JWT | List users (pagination, search) |
| GET | `/api/users/:id` | JWT | Get user by ID |
| GET | `/api/users/:id/activity` | JWT | User upload/delete activity |
| POST | `/api/users` | JWT | Create user |
| PUT | `/api/users/:id` | JWT | Update user |
| DELETE | `/api/users/:id` | JWT | Delete user |

### Cloudflare / My Storage (`/api/cloudflare`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/cloudflare/misc-files` | JWT | List misc files |
| DELETE | `/api/cloudflare/misc-files` | JWT | Delete misc file |
| GET | `/api/cloudflare/resources` | JWT | List storage resources |
| GET | `/api/cloudflare/videos-with-mock-urls` | JWT | Videos with placeholder URLs |
| GET | `/api/cloudflare/videos-by-url` | JWT | Videos by streaming URL |
| POST | `/api/cloudflare/upload` | JWT | Upload to my-storage |
| PUT | `/api/cloudflare/resources/:id` | JWT | Update resource |
| DELETE | `/api/cloudflare/resources/:id` | JWT | Delete resource |
| GET | `/api/cloudflare/cleanup-orphaned` | JWT | Find orphaned files |

### Streaming & Redirects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/HEAD/OPTIONS | `/api/s/:slug` | Stream by short slug |
| GET/HEAD/OPTIONS | `/s/:slug` | Stream by short slug (root) |
| GET | `/:slug` | Redirect slug to frontend video page |

### Static File Serving

| Path | Content |
|------|---------|
| `/video-storage/*` | Video files |
| `/qr-codes/*` | QR code images |
| `/thumbnails/*` | Thumbnail images |
| `/upload/*` | Backend upload folder |
| `/subtitles/*` | Generated VTT subtitles |
| `/video-storage/captions/*` | Uploaded captions |

---

## Database

### Base Tables (`database/schema.sql`)

#### `videos`

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK | Auto increment |
| video_id | VARCHAR(100) UNIQUE | Public identifier |
| title | VARCHAR(255) | Display title |
| grade | INT | Grade level |
| unit | INT | Unit number |
| lesson | INT | Lesson number |
| topic | VARCHAR(255) | Topic slug (no spaces) |
| description | TEXT | Optional |
| language | VARCHAR(10) | Default `en` |
| file_path | VARCHAR(500) | Relative file path |
| streaming_url | VARCHAR(500) | Stream endpoint URL |
| qr_url | VARCHAR(500) | QR code image URL |
| redirect_slug | VARCHAR(100) UNIQUE | Short URL slug |
| duration | INT | Seconds |
| size | BIGINT | Bytes |
| version | INT | Current version number |
| status | ENUM | `active`, `inactive`, `deleted` |

**Extended columns** (via migrations): `course`, `module`, `activity`, `thumbnail_url`, `partner_id`, `views`, etc.

#### `redirects`

Maps short slugs to target URLs.

#### `captions`

VTT caption files per video/language (unique per `video_id` + `language`).

#### `video_versions`

Historical versions when video files are replaced.

#### `admins`

Admin accounts with bcrypt password hashes.

**Extended columns** (via `migration_user_roles.sql`): `full_name`, `can_upload_videos`, `can_view_videos`, `can_check_links`, and additional permission flags.

#### `analytics`

Reserved for future event tracking (`event_type`, `metadata` JSON).

### Additional Tables (Migrations)

| Table | Migration | Purpose |
|-------|-----------|---------|
| `cloudflare_resources` | `migration_cloudflare_resources.sql` | Cloudflare R2/Stream file metadata |
| `csv_upload_history` | `migration_csv_upload_history.sql` | Bulk CSV upload audit log |
| `video_replacements` | `migration_video_replacements.sql` | Video replacement audit trail |

### Migrations

Run as needed after initial `schema.sql`:

```
database/migration_user_roles.sql
database/migration_cloudflare_resources.sql
database/migration_csv_upload_history.sql
database/migration_video_replacements.sql
database/migration_add_thumbnail_field.sql
database/migration_add_modules.sql
database/migration_complete_update.sql
... and others
```

See `database/README_MIGRATION.md` for migration guidance.

---

## File Storage

### Video ID Convention

```
G{grade}_U{unit}_L{lesson}_{TopicNoSpaces}
```

Example: `G03_U02_L01_InputDevices`

### Folder Layout

```
video-storage/
└── G{grade}/
    └── U{unit}/
        └── L{lesson}/
            └── {VIDEO_ID}_v{version}_master.mp4
```

### QR Codes

Stored in `qr-codes/` as PNG images, referenced by `qr_url` in the database.

### Captions

- Uploaded: `video-storage/captions/{VIDEO_ID}_{lang}.vtt`
- Auto-generated: `subtitles/{name}.vtt`

---

## Authentication & Authorization

- **JWT** tokens issued on login, stored in `localStorage` on the frontend
- Token sent as `Authorization: Bearer <token>`
- Default expiry: 7 days (`JWT_EXPIRES_IN`)
- Role-based permissions on `admins` table (upload, view, check links, etc.)
- Protected routes use `authenticateToken` middleware in `backend/middleware/auth.js`

---

## Video Streaming

Streaming is handled by `streamController.js` with:

- HTTP **Range** request support (partial content / seeking)
- CORS headers for cross-origin players
- Multiple entry points:
  - `GET /api/videos/:videoId/stream`
  - `GET /api/s/:slug` (short slug)
  - `GET /s/:slug` (root-level)

The frontend `StreamPage` and `VideoPlayer` components consume these endpoints. HLS support is available via `hls.js` and Video.js plugins.

---

## Automated Video System

Located at `backend/automated-video-system/` — a **standalone** Node.js service for automatic subtitle generation.

**Requirements:** Node.js 18+, FFmpeg, OpenAI Whisper (`pip install openai-whisper`)

| Command | Description |
|---------|-------------|
| `npm start` | Start server on port 3001 |
| `npm run watch` | Folder watcher for auto-processing |

| Endpoint | Description |
|----------|-------------|
| POST `/upload` | Upload video, auto-generate VTT subtitles |
| GET `/video/:name` | Serve video file |
| GET `/subtitle/:name` | Serve subtitle file |
| GET `/videos` | List all videos |
| DELETE `/video/:name` | Delete video + subtitle |

See `backend/automated-video-system/README.md` for full details.

---

## Backend Scripts

Run from `backend/` directory:

| Script | Command | Purpose |
|--------|---------|---------|
| `createAdmin.js` | `npm run create-admin` | Create admin user |
| `checkDatabase.js` | `npm run check-db` | Verify DB connection |
| `generateShortLinksForAllVideos.js` | `npm run generate-short-links` | Generate short links |
| `runCloudflareMigration.js` | `npm run migrate-cloudflare` | Cloudflare table migration |
| `runCsvHistoryMigration.js` | `npm run migrate-csv-history` | CSV history migration |
| `runVideoReplacementsMigration.js` | `npm run migrate-video-replacements` | Replacements migration |
| `generateSubtitles.js` | `npm run generate-subtitles` | Generate subtitles for one video |
| `generateSubtitlesForAllVideos.js` | `npm run generate-all-subtitles` | Batch subtitle generation |
| `generateAndImportAllSubtitles.js` | `npm run generate-and-import-all` | Generate + import to captions |
| `importSubtitlesToCaptions.js` | `npm run import-subtitles` | Import subtitles to DB |
| `syncSubtitlesToCaptions.js` | `npm run sync-subtitles` | Sync subtitle files |
| `cleanupUnusedSubtitles.js` | `npm run cleanup-subtitles` | Remove orphan subtitles |
| `checkSubtitleDependencies.js` | `npm run check-subtitle-deps` | Verify FFmpeg/Whisper |
| `checkSubtitleSystem.js` | `npm run check-subtitles` | Subtitle system health |
| `checkSubtitleStatus.js` | `npm run check-subtitle-status` | Per-video subtitle status |
| `checkVideoIds.js` | `npm run check-videos` | Validate video IDs |
| `killPort.js` | `npm run kill-port` | Free occupied port |

---

## Setup & Running

### Prerequisites

- Node.js 18+
- MySQL 8.0+
- npm

### Quick Start

```bash
# 1. Database
mysql -u root -p < database/schema.sql
mysql -u root -p video_delivery < database/seed.sql   # optional

# 2. Backend
cd backend
npm install
# Create .env (see Configuration below)
npm run dev

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev

# 4. Create storage directories (from project root)
mkdir -p video-storage qr-codes
```

### Production Build

```bash
cd frontend && npm run build    # Output: frontend/dist/
cd backend && npm start         # Serves API + static files
```

See also: `README.md`, `SETUP.md`

---

## Configuration

### Backend Environment Variables (`backend/.env`)

```env
# Server
PORT=5000
NODE_ENV=development

# Database
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=video_delivery
DB_PORT=3306

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# Upload
MAX_FILE_SIZE=1073741824
UPLOAD_PATH=../video-storage

# CDN
USE_CDN=false
CDN_BASE_URL=https://cdn.myorg.org/
LOCAL_BASE_URL=http://localhost:5000/video-storage/

# URLs
FRONTEND_URL=http://localhost:5173
BASE_URL=http://localhost:5000
```

### Frontend

API base URL is resolved via `frontend/src/utils/apiConfig.js` (typically points to backend on port 5000).

---

## Deployment Notes

- Backend sets `trust proxy` for reverse proxy / HTTPS detection (A2Hosting, nginx)
- CORS allows configured production domains
- Static video files can be served via CDN when `USE_CDN=true`
- `.htaccess` files present for Apache hosting
- Upload limit: 5GB per video (multer config in routes)
- Change default admin password before production use

---

## Related Documentation

| File | Contents |
|------|----------|
| `README.md` | Quick start & feature overview |
| `SETUP.md` | Step-by-step setup guide |
| `database/README_MIGRATION.md` | Database migration instructions |
| `backend/automated-video-system/README.md` | Subtitle automation system |
| `backend/automated-video-system/QUICK_START.md` | Quick start for subtitle system |

---

*Generated project documentation for the Video Streaming Platform.*
