# Video Descriptions

Admin page for managing **AI-generated video descriptions** from subtitle (VTT) transcripts. Subtitles are created automatically on upload; descriptions are generated only via **Gemini** or **OpenAI** — never from the MP4 directly and never via a local summarizer.

**URL:** `/admin/video-descriptions`  
**Access:** Authenticated admin only (`ProtectedRoute`)

---

## Overview

| Area | Purpose |
|------|---------|
| **Admin UI** | Filter videos, view subtitles & AI descriptions, generate individually or in bulk |
| **Subtitle pipeline** | Automatic on upload/replace: Whisper → `.vtt` beside the video |
| **Description pipeline** | After VTT exists: AI reads transcript text and writes `videos.description` |
| **Manual edits** | **Disabled** — descriptions are AI-only |

---

## Admin page (`VideoDescriptions.jsx`)

### Filters (same metadata as Video Library)

| Filter | Query param | Notes |
|--------|-------------|-------|
| Search | `search` | Title, video ID, description, subject, grade, etc. (debounced) |
| Subject | `subject` | Resets dependent filters when changed |
| Grade | `grade` | |
| Unit | `unit` | |
| Lesson | `lesson` | |
| Module | `module` | |
| Version | `version` | |
| Description | `descriptionStatus` | `all` \| `missing` \| `has` (AI descriptions only) |

Filter options load from `GET /api/videos/filters`. Filter state is saved in `localStorage` (`video_descriptions_filters_v1`).

### Pagination

| Setting | Value |
|---------|-------|
| Default page size | 25 |
| Max page size | 100 |
| Query params | `page`, `limit` |

Response includes `pagination: { page, limit, total, totalPages }`. Changing filters resets to page 1.

### Table columns

| Column | Description |
|--------|-------------|
| **Checkbox** | Select rows for bulk generate |
| **Video ID** | `video_id` + database `#id` |
| **Title** | Video title |
| **Subject** | Subject + grade/unit hint |
| **Subtitles** | Status badge + read-only transcript from `.vtt` |
| **Description (AI)** | Read-only; empty until AI generates |
| **Actions** | Generate, Clear |

### Subtitle status badges

| Badge | Meaning |
|-------|---------|
| **Yes** | VTT file exists |
| **No** | No VTT yet |
| **Processing** | Subtitle or AI job in progress |
| **Failed** | Subtitle generation failed |

### Actions

| Button | What it does |
|--------|----------------|
| **Generate** | `POST /api/videos/:id/generate-description` — one video |
| **Generate Selected** | Bulk generate for checked rows (missing AI only) |
| **Generate All Filtered Missing** | Bulk generate for **all videos matching filters** (up to 50 per job, all pages) |
| **Clear** | `DELETE /api/admin/video/:id/description` — removes AI description |
| **Refresh** | Reload current page |
| **Select All / Deselect All** | Toggle checkboxes on current page |

Bulk jobs run **in the background** (HTTP 202). The page auto-refreshes every 5 seconds while subtitles or AI descriptions are processing.

---

## API endpoints

### Admin (`/api/admin/`, requires `authenticateToken`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/videos` | Paginated, filterable video list |
| `POST` | `/videos/bulk-generate-descriptions` | Start background bulk AI generation |
| `DELETE` | `/video/:id/description` | Clear AI description |
| `PUT` | `/video/:id/description` | **403** — manual edits disabled |

#### `GET /api/admin/videos`

**Query params:** `page`, `limit`, `search`, `subject`, `grade`, `unit`, `lesson`, `module`, `version`, `descriptionStatus`

**Response:**

```json
{
  "videos": [
    {
      "id": 353,
      "video_id": "VID_PR6BNUDD5Y",
      "title": "Classic Fairy Tales - Cinderella",
      "subject": "English",
      "grade": "5",
      "unit": "2",
      "lesson": null,
      "module": null,
      "version": "1.0",
      "description": "Students explore…",
      "description_source": "gemini",
      "has_ai_description": true,
      "subtitle_text": "Once upon a time…",
      "subtitle_status": "Yes",
      "has_vtt": true,
      "ai_status": "done",
      "updated_at": "2026-06-17T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 120,
    "totalPages": 5
  }
}
```

Only descriptions with `description_source` of `openai` or `gemini` are shown in the UI.

#### `POST /api/admin/videos/bulk-generate-descriptions`

**Body:**

```json
{
  "missingOnly": true,
  "videoIds": [353, 354],
  "filters": {
    "subject": "Science",
    "descriptionStatus": "missing"
  }
}
```

- Omit `videoIds` to use `filters` (all matching videos, not just current page).
- Max **50 videos** per job.
- **1.5s delay** between each video (rate-limit protection).
- Returns **202** immediately; processing continues on the server.

```json
{
  "success": true,
  "started": true,
  "queued": 12,
  "missingOnly": true,
  "message": "Started generating descriptions for up to 12 video(s) in the background."
}
```

### Video routes (`/api/videos/`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/:id/generate-description` | Generate AI description for one video (also used from Video Library) |

---

## Automatic pipeline (upload / replace)

Not triggered from admin buttons for subtitles; runs in the background.

```text
Video upload or replace
  → scheduleVttGeneration() (background queue)
  → FFmpeg extracts audio
  → Whisper transcribes to WebVTT
  → Save VID_xxx.vtt beside VID_xxx.mp4
  → tryGenerateDescriptionAfterCaption()
  → generateAiDescriptionForVideo() reads VTT transcript only
  → UPDATE videos.description, description_source, ai_status
```

**On video replace:** old VTT is deleted, new VTT is generated, description is forced to refresh.

There is **no** manual “Generate subtitles” button in the admin UI. Use the background job or CLI scripts for backfill.

---

## AI provider configuration

Set in `backend/.env`:

```env
# Preferred: Gemini (free tier works with gemini-2.5-flash-lite)
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-2.5-flash-lite

# Optional fallback
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4o-mini

# Optional override: gemini | openai
# AI_DESCRIPTION_PROVIDER=gemini
```

**Provider priority:** Gemini if key exists → OpenAI fallback on Gemini failure.

**Gemini model fallbacks** (on quota/overload): `gemini-2.5-flash-lite` → `gemini-2.5-flash` → retries with backoff.

Restart the backend after changing `.env`.

---

## Description generation logic

`backend/utils/generateAiDescription.js`:

1. Require `GEMINI_API_KEY` or `OPENAI_API_KEY`.
2. Resolve VTT path; fail if subtitles missing or transcript too short.
3. Build prompt from transcript (max ~12k chars).
4. Call Gemini (with retries/fallbacks) or OpenAI.
5. Save `description`, `description_source` (`gemini` \| `openai`), `ai_status = done`.

Manual `PUT` description updates return **403**.

---

## Database

| Column | Table | Notes |
|--------|-------|-------|
| `description` | `videos` | AI-generated text |
| `description_source` | `videos` | `gemini` \| `openai` \| `NULL` |
| `ai_status` | `videos` | `pending` \| `processing` \| `done` \| `failed` |
| `subject`, `grade`, `unit`, `lesson`, `module`, `version` | `videos` | Used for filters |

---

## VTT storage (1:1 with video)

| Video path | Subtitle path |
|------------|---------------|
| `backend/upload/VID_123.mp4` | `backend/upload/VID_123.vtt` |
| `video-storage/my-storage/slug.mp4` | `video-storage/my-storage/slug.vtt` |

Legacy: `video-storage/captions/{videoId}_en.vtt` (checked after co-located paths).

See also: [CC_SUBTITLE_FLOW.md](./CC_SUBTITLE_FLOW.md)

---

## CLI scripts (bulk / repair)

Run from `backend/`:

```bash
# Descriptions from existing VTT only (no Whisper)
npm run generate-descriptions-from-vtt

# Missing VTT + descriptions (same as background job, manual run)
npm run generate-missing-vtt

# Check OpenAI key / quota
npm run check-openai
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Subtitles = **No** | Background Whisper job pending or failed | Wait and refresh; run `npm run generate-missing-vtt` |
| Subtitles = **Processing** | Job in queue | Auto-refresh; check backend logs |
| Description empty | No VTT yet, or AI not run | Wait for pipeline or click **Generate** |
| **Gemini quota / high demand** | Model overload or billing | Use `GEMINI_MODEL=gemini-2.5-flash-lite`; wait and retry; enable billing in Google AI Studio |
| **OpenAI quota exceeded** | No credits | Add billing at platform.openai.com or rely on Gemini |
| Bulk returns error immediately | No videos match filters | Adjust filters; ensure subtitles exist |
| Bulk seems stuck | Runs in background | Watch blue banner; page refreshes every 5s |
| `500` on admin videos list | Backend error | Check server logs; restart backend |

---

## File map

```text
frontend/src/pages/VideoDescriptions.jsx    # Admin UI (filters, pagination, bulk)
frontend/src/pages/VideoList.jsx            # Per-card Generate description
frontend/src/App.jsx                          # Route: admin/video-descriptions
frontend/src/components/Sidebar.jsx           # Nav link

backend/controllers/videoDescriptionController.js
backend/routes/adminRoutes.js
backend/routes/videoRoutes.js                   # POST /:id/generate-description
backend/utils/generateAiDescription.js
backend/utils/geminiClient.js
backend/utils/openaiClient.js
backend/utils/generateDescriptionFromVtt.js
backend/utils/afterCaptionSaved.js
backend/utils/videoMetadataFilters.js
backend/utils/vttLifecycle.js
backend/utils/vttUtils.js
backend/services/vttProcessorService.js
backend/jobs/vttBackgroundProcessor.js

backend/scripts/generateDescriptionsFromExistingVtt.js
backend/scripts/generateMissingVttAndDescriptions.js
```

---

## Related pages

- **Video Library** (`/admin/videos`) — Search, filter, card/list view; optional per-video **Generate description**.
- **CC / subtitles** — [CC_SUBTITLE_FLOW.md](./CC_SUBTITLE_FLOW.md)
