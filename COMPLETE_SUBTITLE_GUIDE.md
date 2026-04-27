# Complete Subtitle System Guide

## 📋 Table of Contents

1. [Overview](#overview)
2. [Video Player Used](#video-player-used)
3. [How Subtitles Work](#how-subtitles-work)
4. [Subtitle Generation](#subtitle-generation)
5. [Multi-Language Support](#multi-language-support)
6. [Picture-in-Picture (Subtitle Overlay)](#picture-in-picture-subtitle-overlay)
7. [Storage Locations](#storage-locations)
8. [Automatic Generation](#automatic-generation)
9. [Manual Generation](#manual-generation)
10. [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

This video streaming system includes a **fully automated subtitle generation and management system** that:

- ✅ Automatically generates subtitles when videos are uploaded
- ✅ Uses **native HTML5 video player** with built-in subtitle support
- ✅ Supports **multiple languages** per video
- ✅ Displays subtitles as **overlay on video** (picture-in-picture style)
- ✅ Works **completely offline** using FFmpeg and OpenAI Whisper
- ✅ Automatically cleans up when videos are deleted

---

## 🎬 Video Player Used

### **SimpleVideoPlayer** - Native HTML5 Video Player

**Location**: `frontend/src/components/SimpleVideoPlayer.jsx`

**Technology**: 
- Native HTML5 `<video>` element
- Native HTML5 `<track>` elements for subtitles
- No external libraries (no Video.js, no dependencies)

**Why This Player?**
- ✅ Simple and reliable
- ✅ Built-in subtitle support
- ✅ CC button appears automatically
- ✅ Works on all modern browsers
- ✅ Lightweight (no heavy dependencies)
- ✅ Picture-in-picture subtitle overlay (native browser feature)

**Features**:
- Automatic CC button when subtitles available
- Multiple language tracks
- View tracking
- Error handling
- Loading states

**Used In**:
- `StreamPage.jsx` - Public video streaming page
- `ShortUrlRedirect.jsx` - Short URL redirect page
- `PublicVideoPage.jsx` - Public video page

---

## 🎥 How Subtitles Work

### Step-by-Step Flow

#### 1. **Video Upload**
```
User uploads video → Video saved → Subtitle generation starts (async)
```

#### 2. **Subtitle Generation Process**
```
Video File (.mp4)
    ↓
FFmpeg extracts audio → Audio file (.wav)
    ↓
OpenAI Whisper transcribes → Text with timestamps
    ↓
Generates WebVTT file → .vtt file
    ↓
Saves to video-storage/captions/ → Final location
    ↓
Adds to database → captions table
```

#### 3. **Video Playback**
```
User opens video page
    ↓
Frontend fetches video data → Includes captions array
    ↓
SimpleVideoPlayer receives captions
    ↓
Builds caption URLs → /video-storage/captions/VID_XXX_en.vtt
    ↓
Adds <track> elements to <video>
    ↓
Browser loads subtitles → CC button appears
    ↓
User clicks CC → Subtitles overlay on video
```

---

## 🔧 Subtitle Generation

### Technology Stack

1. **FFmpeg** - Extracts audio from video
2. **OpenAI Whisper** (Local) - Converts speech to text
3. **WebVTT Format** - Standard subtitle format for HTML5 video

### Generation Process

#### Step 1: Audio Extraction
```bash
ffmpeg -i video.mp4 -ar 16000 -ac 1 -f wav audio.wav
```
- Extracts audio at 16kHz sample rate
- Mono channel (required by Whisper)
- Saves as WAV format

#### Step 2: Speech-to-Text
```bash
whisper audio.wav --model base --output_format vtt --language en
```
- Uses OpenAI Whisper (local, offline)
- Model: `base` (balanced speed/accuracy)
- Output: WebVTT format (.vtt)
- Language: Auto-detect or specify

#### Step 3: WebVTT Format
```vtt
WEBVTT

00:00:00.000 --> 00:00:05.000
Hello, welcome to this video.

00:00:05.000 --> 00:00:10.000
Today we will learn about subtitles.
```

### Code Implementation

**File**: `backend/utils/subtitleGenerator.js`

```javascript
import { generateSubtitles } from '../utils/subtitleGenerator.js';

// Generate subtitles for a video
await generateSubtitles(videoPath, {
  outputPath: 'path/to/output.vtt',
  model: 'base',        // tiny, base, small, medium, large
  language: null        // Auto-detect, or 'en', 'es', 'fr', etc.
});
```

---

## 🌍 Multi-Language Support

### How It Works

The system supports **multiple subtitle languages per video**. Each language is stored as a separate caption track.

### Database Structure

```sql
captions table:
- id (primary key)
- video_id (foreign key to videos)
- language (e.g., 'en', 'es', 'fr', 'ar')
- file_path (e.g., 'captions/VID_XXX_en.vtt')
```

### Adding Multiple Languages

#### Method 1: Automatic (During Upload)
```javascript
// When uploading, generate for specific language
await generateSubtitles(videoPath, {
  model: 'base',
  language: 'en'  // English
});

// Later, add another language
await generateSubtitles(videoPath, {
  model: 'base',
  language: 'es'  // Spanish
});
```

#### Method 2: Manual Upload
```javascript
// Upload caption file via API
POST /api/captions/upload
{
  videoId: 'VID_XXX',
  language: 'fr',
  caption: <file>
}
```

### Video Player Display

The player automatically shows all available languages:

```html
<video>
  <track kind="captions" src="VID_XXX_en.vtt" srcLang="en" label="English" default />
  <track kind="captions" src="VID_XXX_es.vtt" srcLang="es" label="Spanish" />
  <track kind="captions" src="VID_XXX_fr.vtt" srcLang="fr" label="French" />
</video>
```

**User Experience**:
1. CC button appears in video controls
2. Click CC button → Shows language menu
3. Select language → Subtitles change instantly
4. Multiple languages can be toggled

---

## 📺 Picture-in-Picture (Subtitle Overlay)

### How Subtitles Overlay on Video

Subtitles are displayed as **overlay text on top of the video** using native browser capabilities:

#### Visual Layout
```
┌─────────────────────────────┐
│                             │
│      Video Content          │
│                             │
│  ┌─────────────────────┐   │
│  │  Subtitle Text      │   │ ← Overlay (bottom center)
│  └─────────────────────┘   │
│                             │
└─────────────────────────────┘
```

#### CSS Styling (Browser Default)
- Position: Bottom center of video
- Background: Semi-transparent black
- Text: White, readable font
- Padding: Comfortable spacing
- Animation: Fade in/out with timing

#### Customization

The browser handles subtitle styling automatically, but you can customize via CSS:

```css
video::cue {
  background-color: rgba(0, 0, 0, 0.8);
  color: white;
  font-size: 18px;
  padding: 5px 10px;
  border-radius: 4px;
}

video::cue(span) {
  font-weight: bold;
}
```

### Timing Synchronization

Subtitles are **synchronized with video playback**:

```vtt
00:00:05.000 --> 00:00:10.000
This subtitle appears at 5 seconds
and disappears at 10 seconds.
```

The browser automatically:
- Shows subtitle when video reaches start time
- Hides subtitle when video reaches end time
- Updates in real-time as video plays

---

## 📁 Storage Locations

### Active Location (Used by Player) ✅

**Path**: `video-storage/captions/VID_XXX_language.vtt`

- **Purpose**: Final caption files used by video player
- **Format**: `VID_XXX_en.vtt`, `VID_XXX_es.vtt`, etc.
- **Served via**: `http://localhost:5000/video-storage/captions/VID_XXX_en.vtt`
- **Database**: Stored in `captions` table
- **Status**: ✅ **KEEP THIS - Used by player**

### Temporary Location (Can Delete) ⚠️

**Path**: `backend/subtitles/VID_XXX.vtt`

- **Purpose**: Temporary files during generation
- **Format**: `VID_XXX.vtt` (no language suffix)
- **Status**: ⚠️ **Can be deleted after import**

### File Flow

```
1. Generate → backend/subtitles/VID_XXX.vtt (temp)
2. Import → video-storage/captions/VID_XXX_en.vtt (final)
3. Database → file_path = 'captions/VID_XXX_en.vtt'
4. Player → Loads from video-storage/captions/
```

---

## ⚡ Automatic Generation

### When Videos Are Uploaded

Subtitles are **automatically generated** in the background when:

1. **Regular Upload** (`/api/videos/upload`)
2. **Cloudflare Upload** (`/api/cloudflare/upload`)

### How It Works

```javascript
// After video is saved
(async () => {
  // Generate subtitles (non-blocking)
  await generateSubtitles(videoPath, {
    model: 'base',
    language: null  // Auto-detect
  });
  
  // Save to caption system
  await captionService.uploadCaption(videoId, 'en', subtitleBuffer);
})();
```

### Benefits

- ✅ No manual action needed
- ✅ Non-blocking (upload completes immediately)
- ✅ Subtitles appear when ready
- ✅ Works for all new uploads

---

## 🛠️ Manual Generation

### Generate for All Existing Videos

```bash
cd backend
npm run generate-and-import-all
```

**What it does**:
1. Scans `backend/upload/` for all `.mp4` videos
2. Finds each video in database
3. Generates subtitles using Whisper
4. Imports to `video-storage/captions/`
5. Adds to database

### Generate for Single Video

```bash
cd backend
npm run generate-subtitles path/to/video.mp4
```

### Options

```bash
# Use different Whisper model
npm run generate-and-import-all -- --model small

# Specify language
npm run generate-and-import-all -- --language en

# Skip videos that already have subtitles
npm run generate-and-import-all -- --skip-existing
```

---

## 🧹 Cleanup and Management

### Clean Up Temporary Files

```bash
cd backend
npm run cleanup-subtitles
```

**Removes**:
- Temp files from `backend/subtitles/` (already imported)
- Orphaned files (videos not in database)

**Keeps**:
- All files in `video-storage/captions/` (active)

### Check Subtitle Status

```bash
cd backend
npm run check-subtitle-status
```

**Shows**:
- Which videos have subtitles
- Which videos are missing subtitles
- Summary statistics

### Automatic Deletion

When you **permanently delete** a video:
- ✅ Caption files deleted from `video-storage/captions/`
- ✅ Temp files deleted from `backend/subtitles/`
- ✅ Database entries removed

**No manual cleanup needed!**

---

## 🔍 Troubleshooting

### Subtitles Not Showing

#### Check 1: Verify Subtitles Exist
```bash
cd backend
npm run check-subtitle-status
```

#### Check 2: Verify Caption File
```bash
# Check if file exists
ls video-storage/captions/VID_XXX_en.vtt

# Check if accessible
curl http://localhost:5000/video-storage/captions/VID_XXX_en.vtt
```

#### Check 3: Check Database
```sql
SELECT * FROM captions WHERE video_id = 'VID_XXX';
```

#### Check 4: Browser Console
Open browser DevTools (F12) and check:
- Caption loading errors
- Network requests for .vtt files
- CORS errors

### CC Button Not Appearing

**Possible Causes**:
1. No captions in database
2. Caption file doesn't exist
3. CORS issue
4. Invalid VTT format

**Solution**:
1. Verify captions exist: `npm run check-subtitle-status`
2. Check browser console for errors
3. Verify caption URL is accessible
4. Check VTT file format is valid

### Generation Fails

**Check Dependencies**:
```bash
cd backend
npm run check-subtitle-deps
```

**Required**:
- ✅ FFmpeg installed and in PATH
- ✅ Python installed
- ✅ OpenAI Whisper installed: `pip install openai-whisper`

**Verify**:
```bash
ffmpeg -version
python --version
whisper --help
```

---

## 📊 System Architecture

### Components

```
┌─────────────────────────────────────────┐
│         Video Upload                    │
│  (Regular or Cloudflare)                │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│    Subtitle Generator                    │
│  (FFmpeg + Whisper)                      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│    Caption Service                      │
│  (Saves to storage + database)          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│    Video Player                         │
│  (SimpleVideoPlayer - HTML5)             │
│  - Loads captions from API              │
│  - Adds <track> elements                │
│  - Displays overlay subtitles           │
└─────────────────────────────────────────┘
```

### Database Schema

```sql
CREATE TABLE captions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  video_id VARCHAR(100) NOT NULL,
  language VARCHAR(10) NOT NULL DEFAULT 'en',
  file_path VARCHAR(500) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_video_language (video_id, language)
);
```

---

## 🎯 Quick Reference

### Commands

```bash
# Generate subtitles for all videos
npm run generate-and-import-all

# Check subtitle status
npm run check-subtitle-status

# Clean up temp files
npm run cleanup-subtitles

# Check dependencies
npm run check-subtitle-deps
```

### File Locations

- **Active**: `video-storage/captions/VID_XXX_language.vtt` ✅
- **Temp**: `backend/subtitles/VID_XXX.vtt` ⚠️

### API Endpoints

- `GET /api/videos/:videoId` - Returns video with captions array
- `GET /api/captions/:videoId` - Get all captions for video
- `POST /api/captions/upload` - Upload caption file manually

---

## ✅ Summary

### What You Need to Know

1. **Player**: Native HTML5 video player (`SimpleVideoPlayer`)
2. **Generation**: Automatic on upload (FFmpeg + Whisper)
3. **Storage**: `video-storage/captions/` (active location)
4. **Format**: WebVTT (.vtt files)
5. **Display**: Overlay on video (picture-in-picture style)
6. **Languages**: Multiple languages supported per video
7. **Cleanup**: Automatic when videos deleted

### Key Features

- ✅ **Fully Automated** - No manual steps needed
- ✅ **Offline** - No cloud services, no APIs
- ✅ **Multi-Language** - Support for any language
- ✅ **Picture-in-Picture** - Native browser subtitle overlay
- ✅ **Auto-Cleanup** - Deletes subtitles when videos deleted

---

## 🚀 Getting Started

### For New Videos

**Just upload normally** - subtitles generate automatically!

### For Existing Videos

```bash
cd backend
npm run generate-and-import-all
```

### Verify It Works

1. Upload a video
2. Wait for subtitle generation (check backend logs)
3. Open video page
4. CC button should appear
5. Click CC → Subtitles overlay on video

**That's it!** 🎉


