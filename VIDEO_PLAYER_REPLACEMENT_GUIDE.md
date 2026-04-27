# Video Player Replacement Guide

## ✅ What Was Done

### 1. Created Simple HTML5 Video Player
- **New Component**: `frontend/src/components/SimpleVideoPlayer.jsx`
- Uses native HTML5 `<video>` and `<track>` elements
- Much simpler and more reliable than Video.js
- Automatically loads subtitles from captions array

### 2. Replaced VideoPlayer in All Pages
- ✅ `StreamPage.jsx` - Now uses SimpleVideoPlayer
- ✅ `ShortUrlRedirect.jsx` - Now uses SimpleVideoPlayer  
- ✅ `PublicVideoPage.jsx` - Now uses SimpleVideoPlayer

### 3. Automatic Subtitle Generation
- ✅ **Video Upload** (`/api/videos/upload`) - Automatically generates subtitles
- ✅ **Cloudflare Upload** (`/api/cloudflare/upload`) - Automatically generates subtitles
- Subtitles are generated asynchronously (don't block upload response)
- Saved to `video-storage/captions/` and added to database

### 4. Static File Serving
- ✅ Added `/subtitles` route to serve subtitle files
- ✅ `/video-storage/captions` already served for caption files

## 🎬 How It Works

### Upload Flow with Auto-Subtitles

1. **User uploads video** (via Cloudflare or regular upload)
2. **Video saved** to storage
3. **Subtitle generation starts** (async, non-blocking):
   - FFmpeg extracts audio
   - Whisper transcribes to text
   - Generates .vtt file
   - Saves to `video-storage/captions/`
   - Adds entry to `captions` table
4. **Response sent** immediately (doesn't wait for subtitles)
5. **Subtitles appear** in video player when ready

### Video Playback

1. **Video loads** from streaming URL
2. **Captions fetched** from `/api/videos/:videoId` or `/api/captions/:videoId`
3. **Subtitle tracks added** to HTML5 video element
4. **CC button appears** automatically in browser controls
5. **User clicks CC** to show/hide subtitles

## 📝 SimpleVideoPlayer Usage

```jsx
import SimpleVideoPlayer from '../components/SimpleVideoPlayer';

<SimpleVideoPlayer 
  src={streamingUrl} 
  captions={video.captions || []} 
  autoplay={true}
  videoId={video.video_id}
/>
```

### Props

- `src` (string, required) - Video streaming URL
- `captions` (array, optional) - Array of caption objects:
  ```javascript
  [
    {
      language: 'en',
      file_path: 'captions/VID_123_en.vtt',
      label: 'English'
    }
  ]
  ```
- `autoplay` (boolean, optional) - Auto-play video
- `poster` (string, optional) - Poster image URL
- `videoId` (string, optional) - Video ID for view tracking

## 🔄 Subtitle Generation

### Automatic (Recommended)

Subtitles are **automatically generated** when:
- Video uploaded via `/api/videos/upload`
- Video uploaded via `/api/cloudflare/upload`

### Manual Generation

If you need to generate subtitles manually:

```bash
cd backend
npm run generate-all-subtitles
npm run sync-subtitles
```

## 📁 File Locations

- **Generated subtitles**: `subtitles/` (temporary)
- **Final captions**: `video-storage/captions/` (served by API)
- **Database entries**: `captions` table

## 🎯 Key Features

- ✅ **Simple & Reliable**: Native HTML5 video player
- ✅ **Automatic Subtitles**: Generated on upload
- ✅ **CC Button**: Appears automatically when subtitles available
- ✅ **Multiple Languages**: Supports multiple subtitle tracks
- ✅ **View Tracking**: Tracks video views
- ✅ **Error Handling**: Graceful error messages

## 🔧 Configuration

### Subtitle Generation Settings

Edit `backend/controllers/videoController.js` or `backend/controllers/cloudflareController.js`:

```javascript
model: 'base',  // Options: 'tiny', 'base', 'small', 'medium', 'large'
language: null  // Auto-detect, or set to 'en', 'es', etc.
```

### Subtitle Paths

The system handles multiple path formats:
- `captions/videoId_language.vtt` → `/video-storage/captions/videoId_language.vtt`
- `subtitles/videoId.vtt` → `/subtitles/videoId.vtt`

## 🐛 Troubleshooting

### Subtitles Not Showing

1. **Check if subtitles were generated:**
   ```bash
   cd backend
   npm run check-subtitles VID_YOUR_VIDEO_ID
   ```

2. **Check browser console** for caption loading errors

3. **Verify caption URL** is accessible:
   ```
   http://localhost:5000/video-storage/captions/VID_YOUR_VIDEO_ID_en.vtt
   ```

4. **Check database:**
   ```sql
   SELECT * FROM captions WHERE video_id = 'VID_YOUR_VIDEO_ID';
   ```

### CC Button Not Appearing

- Ensure `captions` array is passed to SimpleVideoPlayer
- Check that caption `file_path` is correct
- Verify subtitle file exists and is accessible

## 📊 Comparison

### Old Video.js Player
- ❌ Complex setup
- ❌ Sometimes CC button doesn't show
- ❌ Heavy dependencies
- ❌ Configuration issues

### New SimpleVideoPlayer
- ✅ Simple HTML5 video
- ✅ CC button always works
- ✅ No heavy dependencies
- ✅ Reliable subtitle loading

## 🎉 Result

Now when you upload videos via Cloudflare or regular upload:
1. Video is saved
2. Subtitles are **automatically generated**
3. Subtitles are **automatically shown** in the video player
4. CC button appears and works perfectly!


