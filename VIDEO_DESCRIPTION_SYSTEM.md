# Video Description Management System

Complete reference for the enterprise-grade video description editing, history, and bulk management system.

---

## Table of Contents

1. [Overview](#overview)
2. [File Structure](#file-structure)
3. [Database](#database)
4. [Backend API](#backend-api)
5. [Frontend Components](#frontend-components)
6. [Edit Description Modal](#edit-description-modal)
7. [Bulk Actions](#bulk-actions)
8. [Source Badges](#source-badges)
9. [Description History](#description-history)
10. [How to Use](#how-to-use)
11. [Restart After Changes](#restart-after-changes)

---

## Overview

The Video Description system lets admins view, edit, regenerate, bulk-manage, export, and fully audit AI-generated video descriptions. Every change is stored in a history table and can be restored at any time.

**Key capabilities:**

| Feature | Details |
|---|---|
| Edit description | Free-text edit of any video's AI description |
| History tracking | Every save/clear/regenerate is logged and reversible |
| Restore version | One-click restore from any past snapshot |
| Transcript search | Inline keyword search with highlighted matches |
| Source badges | Color-coded: GEMINI · OPENAI · MANUAL · EMPTY |
| Bulk generate | Generate AI descriptions for selected or all missing |
| Bulk clear | Clear descriptions from selected videos (logged to history) |
| Export CSV | Download selected or all-filtered descriptions |
| Audit panel | Created date, last updated, updated by, source |
| Row selection | Any video is selectable; green highlight on selected row |

---

## File Structure

```
video-streaming/
├── backend/
│   ├── controllers/
│   │   └── videoDescriptionController.js   ← all description API logic
│   ├── routes/
│   │   └── adminRoutes.js                  ← all /api/admin/* routes
│   └── utils/
│       └── descriptionHistory.js           ← history table utility (NEW)
│
└── frontend/src/
    ├── components/
    │   ├── EditDescriptionModal.jsx         ← modal component
    │   └── EditDescriptionModal.css         ← modal styles
    └── pages/
        ├── VideoDescriptions.jsx            ← main page
        └── VideoDescriptions.css           ← page styles + badge styles
```

---

## Database

### `videos` table (existing)

Columns used by this system:

| Column | Type | Notes |
|---|---|---|
| `id` | INT | Primary key |
| `video_id` | VARCHAR | Public video identifier |
| `title` | VARCHAR | Video title |
| `subject`, `grade`, `unit`, `lesson`, `module`, `version` | VARCHAR | Metadata |
| `description` | TEXT | The description text |
| `description_source` | VARCHAR(50) | `gemini`, `openai`, `manual`, or NULL |
| `created_at` | DATETIME | Row creation time |
| `updated_at` | DATETIME | Last modification time |

### `description_history` table (auto-created)

Created automatically on first use — no migration script needed.

```sql
CREATE TABLE IF NOT EXISTS description_history (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  video_id    INT UNSIGNED NOT NULL,
  description TEXT,
  source      VARCHAR(50),
  changed_by  VARCHAR(100) DEFAULT 'system',
  changed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_video_id (video_id),
  INDEX idx_changed_at (changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**What gets recorded:**
- Before every manual save (`PUT /video-descriptions/:id`)
- Before every regenerate (via `POST /videos/:id/generate-description`)
- Before every delete / clear
- Before every bulk clear
- Before every restore (the current version is snapshotted first)

Empty descriptions are never recorded as history entries.

---

## Backend API

All routes are under `/api/admin/` and require a valid JWT (`Authorization: Bearer <token>`).

### Description List

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/videos` | Paginated video list with filters |

Query params: `page`, `limit`, `search`, `subject`, `grade`, `unit`, `lesson`, `module`, `version`, `descriptionStatus` (`all` / `missing` / `has`)

---

### Single Video Description

#### `GET /api/admin/video-descriptions/:videoId`

Fetch full detail for a single video. `:videoId` accepts either the numeric DB `id` or the string `video_id`.

**Response:**
```json
{
  "id": 373,
  "videoId": "VID_AOVS99RZID",
  "title": "Ict Sb G7 U1 L7 Sb V1.0",
  "subject": "ICT",
  "grade": "1",
  "unit": "2",
  "lesson": "3",
  "module": "",
  "version": "1",
  "transcript": "In this video, we will...",
  "description": "This video shows...",
  "descriptionSource": "gemini",
  "updatedAt": "2026-06-24T17:16:34.000Z",
  "createdAt": "2026-01-10T09:00:00.000Z"
}
```

---

#### `PUT /api/admin/video-descriptions/:videoId`

Save an edited description. Archives the current value to history first.

**Request body:**
```json
{
  "description": "Updated description text",
  "updatedBy": "admin"
}
```

**Response:**
```json
{ "success": true, "id": 373, "videoId": "VID_AOVS99RZID" }
```

**Source logic:**
- If `description` is non-empty → preserves existing source; sets to `"manual"` if there was none
- If `description` is empty/null → clears `description_source` to NULL

---

#### `DELETE /api/admin/video/:id/description`

Clear a description. Archives current value to history, then sets both `description` and `description_source` to NULL.

**Response:**
```json
{ "success": true }
```

---

### History

#### `GET /api/admin/video-descriptions/:videoId/history`

Fetch up to 30 history entries for a video, newest first.

**Response:**
```json
{
  "history": [
    {
      "id": 12,
      "video_id": 373,
      "description": "Previous description text...",
      "source": "gemini",
      "changed_by": "admin",
      "changed_at": "2026-06-24T17:10:00.000Z"
    }
  ]
}
```

---

#### `POST /api/admin/video-descriptions/:videoId/restore/:historyId`

Restore a previous version. Archives the current description first, then restores the snapshot.

**Request body:**
```json
{ "restoredBy": "admin" }
```

**Response:**
```json
{
  "success": true,
  "description": "Restored description text...",
  "source": "gemini"
}
```

---

### Bulk Actions

#### `POST /api/admin/videos/bulk-generate-descriptions`

Generate AI descriptions for selected or filtered videos (async, 202 response).

**Request body:**
```json
{
  "videoIds": [373, 374, 375],
  "missingOnly": true
}
```

#### `POST /api/admin/videos/bulk-clear-descriptions`

Clear descriptions from selected videos. Each is archived to history before clearing.

**Request body:**
```json
{ "videoIds": [373, 374] }
```

**Response:**
```json
{ "success": true, "cleared": 2 }
```

#### `POST /api/admin/videos/export-descriptions`

Export descriptions as a CSV file download.

**Request body (optional — omit to export all filtered):**
```json
{ "videoIds": [373, 374, 375] }
```

**Response:** `text/csv` file download with columns:  
`ID, Video ID, Title, Subject, Grade, Unit, Lesson, Module, Version, Description, Source, Updated At`

---

## Frontend Components

### `VideoDescriptions.jsx`

The main admin page at `/admin/descriptions` (or wherever it is routed).

**State:**

| State | Purpose |
|---|---|
| `videos` | Current page of videos |
| `selectedIds` | Set of selected video IDs (any video, not just missing-description) |
| `editModalVideo` | Video row currently open in the edit modal |
| `filters` | All filter values (persisted in localStorage) |
| `bulkGenerating` | True while any bulk operation is in progress |

**Functions:**

| Function | Purpose |
|---|---|
| `fetchVideos(silent, page)` | Load/refresh videos |
| `generateDesc(id)` | Single-video AI generation |
| `clearDesc(id)` | Single-video clear with confirm dialog |
| `runBulkGenerate({ videoIds, missingOnly })` | Bulk AI generation |
| `runBulkClear(videoIds)` | Bulk clear with history archiving |
| `runExport(videoIds?)` | Export CSV (selected or all filtered) |
| `handleToggleSelect(id)` | Toggle individual video selection |
| `handleSelectAll()` | Select/deselect all videos on the page |

---

### `EditDescriptionModal.jsx`

A large two-column modal with three tabs. Props:

| Prop | Type | Purpose |
|---|---|---|
| `videoRow` | Object | The video row from the table (`{ id, video_id, title, ... }`) |
| `onClose` | Function | Called when the modal should close |
| `onSaved({ id, description, regenerated?, keepOpen?, error? })` | Function | Called after save/regenerate/error |
| `onCleared(id)` | Function | Called after a successful clear |

**Internal sub-components:**

| Component | Purpose |
|---|---|
| `SourceBadge` | Color-coded pill showing GEMINI / OPENAI / MANUAL / EMPTY |
| `InfoRow` | Label + value row in the info grid (supports `mono` and `tag` modes) |
| `TabButton` | Accessible tab button with `role="tab"` and `aria-selected` |
| `TranscriptPanel` | Scrollable transcript with inline search (highlights matches) + copy button |
| `HistoryPanel` | Loads and displays history entries; each is expandable; has Restore button |
| `AuditPanel` | Shows full metadata + source/created/updated audit section |

---

## Edit Description Modal

### Layout

```
┌────────────────────────────────────────────────────────┐
│ Edit Video Description    [GEMINI]              [×]    │
│ VID_AOVS99RZID · Ict Sb G7 U1 L7 Sb V1.0              │
├──────────────────────────┬─────────────────────────────┤
│  VIDEO INFORMATION       │  [Edit] [History] [Info]    │
│  ┌──────────────────┐    │  ─────────────────────────  │
│  │ Video ID         │    │  DESCRIPTION          323/  │
│  │ Internal ID      │    │  ┌───────────────────────┐  │
│  │ Title            │    │  │                       │  │
│  │ Subject/Grade... │    │  │   textarea            │  │
│  └──────────────────┘    │  │                       │  │
│                          │  └───────────────────────┘  │
│  TRANSCRIPT              │  Source: gemini  Updated:.. │
│  [Search...      ] [Copy]│  [✨ Regenerate] [🗑 Clear] │
│  ┌──────────────────┐    │                             │
│  │ transcript text  │    │                             │
│  └──────────────────┘    │                             │
├──────────────────────────┴─────────────────────────────┤
│ ⚠ Unsaved changes     [Cancel] [Preview] [Save Changes]│
└────────────────────────────────────────────────────────┘
```

### Tabs

**Edit tab**
- Editable textarea with 2000-char counter (turns red when exceeded)
- Optional inline Preview card (shows formatted title + description)
- Source badge + last updated timestamp
- Regenerate AI / Clear buttons

**History tab**
- Lists up to 30 snapshots, newest first
- Each entry shows: timestamp, changed by, source badge
- Entry matching current description is tagged **current** and Restore is disabled
- Click any entry to expand and read the full text
- Restore button: archives current → applies snapshot → switches back to Edit tab

**Info tab**
- Full video metadata (all fields)
- Audit section: Source badge, Created date, Last Updated date

### Keyboard support

| Key | Action |
|---|---|
| `Escape` | Close modal (with unsaved-changes warning if dirty) |
| `Tab` | Standard browser focus navigation |

### Save button state

The Save Changes button is **disabled** when:
- No changes have been made (`dirty === false`)
- A save is already in progress

---

## Bulk Actions

Accessed via the bulk action bar that appears when one or more rows are selected.

| Action | Button | Behaviour |
|---|---|---|
| Generate selected | ✨ Generate selected | Sends selected IDs to bulk-generate endpoint (async, 202) |
| Clear selected | 🗑 Clear selected | Confirms, archives each to history, clears descriptions |
| Export selected | ↓ Export selected | Downloads CSV of selected videos' descriptions |
| Export all | ↓ Export all | Downloads CSV of all currently-filtered videos |
| Generate all filtered missing | ✨ Generate all filtered missing | Generates for all videos matching current filters that have transcripts but no description |

**Selection scope:**  
Any video can be selected (checkbox enabled for all rows), not just those missing descriptions. This allows bulk-clearing or exporting videos that already have descriptions.

---

## Source Badges

Shown in the table (Description column) and in the modal header and History tab.

| Badge | Color | Meaning |
|---|---|---|
| `GEMINI` | Green | Generated by Google Gemini |
| `OPENAI` | Blue | Generated by OpenAI |
| `MANUAL` | Purple | Manually written or edited by an admin |
| `EMPTY` | Amber | No description exists |

---

## Description History

### When history is recorded

| Action | Records history |
|---|---|
| Save Changes (modal) | ✅ Before overwriting |
| Regenerate AI (modal) | ✅ Before overwriting (via generate endpoint) |
| Clear Description (modal) | ✅ Before clearing |
| Bulk Clear Selected | ✅ Before clearing each |
| Restore Version | ✅ Before restoring (saves current as new snapshot) |

### When history is NOT recorded

- Empty/null descriptions are never stored as snapshots
- Reading (GET) operations never write history

### Retention

Up to 30 entries per video are shown in the UI. The database stores all entries with no automatic pruning.

---

## How to Use

### Edit a single description

1. Click any row in the Video Descriptions table (or click the **Edit** button)
2. The modal opens with the current description in the textarea
3. Edit the text — Save Changes button activates
4. Click **Save Changes** — previous version is saved to history automatically

### View and restore history

1. Open the Edit modal for any video
2. Click the **History** tab
3. Click any entry to expand and read the old text
4. Click **Restore** to revert — current version is archived first

### Search transcript

1. Open the Edit modal
2. The left panel shows the transcript
3. Type in the search box — matching text highlights in yellow
4. Click Copy to copy the full transcript to clipboard

### Bulk generate descriptions

1. Use filters to narrow the list
2. Check individual rows or use the header checkbox to select all
3. Click **Generate selected** in the bulk bar
4. Or click **Generate all filtered missing** to process everything in the current filter with transcripts but no description

### Export descriptions

- Select rows → **Export selected** in the bulk bar
- Or click **Export all** (top-right above table) to export the current filtered view
- File downloads as `descriptions-<timestamp>.csv`

---

## Restart After Changes

After any backend changes, restart the server:

```bash
# from video-streaming/backend
npm run dev
# or
node server.js
```

The `description_history` table is created automatically on first API call — no manual migration needed.

---

## Files Changed in This Implementation

| File | Type | Change |
|---|---|---|
| `backend/utils/descriptionHistory.js` | **NEW** | History table utility |
| `backend/controllers/videoDescriptionController.js` | Updated | Added history recording, new endpoints |
| `backend/routes/adminRoutes.js` | Updated | Added 4 new routes |
| `frontend/src/components/EditDescriptionModal.jsx` | Updated | 3-tab modal with history, audit, transcript search |
| `frontend/src/components/EditDescriptionModal.css` | Updated | Full modal styles + source badge styles |
| `frontend/src/pages/VideoDescriptions.jsx` | Updated | Bulk clear/export, source badges, universal selection |
| `frontend/src/pages/VideoDescriptions.css` | Updated | Source badge styles + selected-row highlight |
