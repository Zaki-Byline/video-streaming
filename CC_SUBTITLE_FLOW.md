# CC Subtitles Working Flow

This document explains how closed captions (CC subtitles) move through the system from upload to playback.

## 1) VTT lifecycle rules (video ↔ subtitle 1:1)

| Event | Action |
|-------|--------|
| Video upload | Extract audio → Whisper → save `VID_123.vtt` beside `VID_123.mp4` |
| Video delete (permanent) | Delete paired VTT + remove caption DB rows |
| Video replace | Delete old VTT → regenerate from new video |
| VTT missing/corrupt | Regenerate from original video if available |

Core module: `backend/utils/vttLifecycle.js`

## 2) Auto-generation on video upload

When a video is uploaded, the backend starts subtitle generation asynchronously (non-blocking):

1. Extract audio from the uploaded video using FFmpeg.
2. Transcribe audio to WebVTT using local Whisper (or OpenAI Whisper API fallback).
3. Save `.vtt` **beside the video** with matching basename (only extension changes).
4. Register relative path in `captions` table for playback APIs.

Examples:

- `backend/upload/VID_123.mp4` → `backend/upload/VID_123.vtt` (DB: `upload/VID_123.vtt`)
- `video-storage/my-storage/slug.mp4` → `video-storage/my-storage/slug.vtt` (DB: `my-storage/slug.vtt`)

Upload triggers:

- `backend/controllers/videoController.js`
- `backend/controllers/cloudflareController.js`
- `backend/utils/subtitleGenerator.js`
- `backend/utils/transcribeAudio.js`

## 3) Caption file and DB storage

**Primary (co-located):** VTT lives next to the video file.

**Legacy fallback:** older files may still exist at `video-storage/captions/<videoId>_en.vtt`.

Database `captions.file_path` stores the relative path used for URL building, e.g.:

- `upload/VID_ABC123.vtt`
- `my-storage/VID_ABC123_master.vtt`
- `captions/VID_ABC123_en.vtt` (legacy)

Service: `backend/services/captionService.js`

## 4) Caption APIs

- `GET /api/captions/:videoId` → fetch captions (includes co-located VTT fallback)
- `POST /api/captions/upload` → manual VTT upload (saves beside video when possible)
- `DELETE /api/captions/:id` → delete caption

Routes: `backend/routes/captionRoutes.js`

## 5) Static serving of caption files

- `/upload/...` — co-located VTT for upload-folder videos
- `/video-storage/my-storage/...` — co-located VTT for my-storage videos
- `/video-storage/captions/...` — legacy captions
- `/subtitles/...` — temp generation only

Defined in `backend/server.js`

## 6) Frontend playback (CC button)

`SimpleVideoPlayer` maps caption `file_path` values to full URLs:

- `upload/...` → `${backendUrl}/upload/...`
- `my-storage/...` → `${backendUrl}/video-storage/my-storage/...`
- `captions/...` → `${backendUrl}/video-storage/captions/...`

Files: `frontend/src/components/SimpleVideoPlayer.jsx`, `VideoPlayer.jsx`

## 7) Missing subtitle recovery

1. Resolve co-located VTT beside video.
2. Fall back to DB path and legacy `captions/` folder.
3. If still missing/corrupt and MP4 exists → `ensureVttFromVideo()` regenerates.

Utilities:

- `backend/utils/vttLifecycle.js` — `ensureVttFromVideo`, `generateVttFromVideo`
- `backend/utils/vttUtils.js` — `resolveVttPath`, `extractText`
- `backend/utils/ensureVttForVideo.js`

Bulk repair: `npm run generate-missing-vtt`

## 8) Description from subtitles (automatic)

After captions are saved, the system reads VTT text and builds a description — **no second pass on the MP4**.

```text
VTT file (co-located or legacy path)
  -> extractText()
  -> buildMetadataFromVtt()
  -> UPDATE videos.description, keywords, tags, ai_status='done'
```

If VTT is missing during description generation, it is regenerated from the video first.

## 9) End-to-end summary

```text
Upload Video (VID_123.mp4)
  -> FFmpeg: video → audio
  -> Whisper: audio → WebVTT
  -> Save VID_123.vtt beside VID_123.mp4 + DB row
  -> Generate description from VTT text
  -> Frontend fetches captions
  -> SimpleVideoPlayer renders <track> tags
  -> Browser shows CC button

Permanent delete video
  -> Delete VID_123.mp4 + VID_123.vtt + caption DB rows

Replace video
  -> Delete old VTT → regenerate new VTT from updated MP4
```
