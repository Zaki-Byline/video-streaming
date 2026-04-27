# Automated Video + Subtitle Management System - Complete Guide

## 🎯 Overview

This is a fully automated Node.js system that handles video uploads, automatic subtitle generation, video playback, and cleanup. It uses FFmpeg for audio extraction and OpenAI Whisper for speech-to-text transcription.

## 📁 Folder Structure

```
video-streaming/
├── upload/                          # Video files stored here
│   └── your-video.mp4
├── subtitles/                       # Auto-generated subtitle files
│   └── your-video.vtt
└── backend/
    └── automated-video-system/      # New automated system
        ├── server.js                # Main Express server
        ├── folderWatcher.js         # Optional folder watcher
        ├── package.json
        ├── start.sh                 # Linux/Mac start script
        ├── start.bat                # Windows start script
        ├── README.md
        └── public/
            └── index.html           # Web interface
```

## 🚀 Quick Start

### Step 1: Install Prerequisites

**FFmpeg:**
- Windows: Download from https://ffmpeg.org/download.html
- Mac: `brew install ffmpeg`
- Linux: `sudo apt-get install ffmpeg`

**OpenAI Whisper:**
```bash
pip install openai-whisper
```

### Step 2: Install Dependencies

```bash
cd backend/automated-video-system
npm install
```

### Step 3: Start the System

**Option A - Using Start Script (Recommended):**

**Windows:**
```bash
start.bat
```

**Linux/Mac:**
```bash
chmod +x start.sh
./start.sh
```

**Option B - Manual Start:**

```bash
npm start
```

The server will start on `http://localhost:3001`

### Step 4: Open Web Interface

Open your browser and go to:
```
http://localhost:3001
```

## 🎬 Usage

### Web Interface

1. **Upload Video:**
   - Click "Choose File"
   - Select a video file
   - Click "Upload & Generate Subtitles"
   - Wait for processing (may take several minutes)

2. **View Videos:**
   - All uploaded videos appear in the grid
   - Click play to watch with subtitles
   - Subtitles are automatically loaded if available

3. **Delete Video:**
   - Click "Delete" button on any video
   - Both video and subtitle are deleted together

### API Usage

**Upload Video:**
```bash
curl -X POST -F "video=@video.mp4" http://localhost:3001/upload
```

**List Videos:**
```bash
curl http://localhost:3001/videos
```

**Get Video:**
```
http://localhost:3001/video/video.mp4
```

**Get Subtitle:**
```
http://localhost:3001/subtitle/video.vtt
```

**Delete Video:**
```bash
curl -X DELETE http://localhost:3001/video/video.mp4
```

## 🔄 Optional: Folder Watcher

The folder watcher automatically generates subtitles for any new video files added to the `upload/` folder, even if not uploaded through the API.

**Start Watcher (in separate terminal):**
```bash
npm run watch
```

**How it works:**
- Watches `upload/` folder for new files
- When a new video is detected, automatically generates subtitles
- Saves subtitles to `subtitles/` folder
- Skips files that already have subtitles

## ⚙️ Configuration

Edit `server.js` to customize:

**Port:**
```javascript
const PORT = process.env.PORT || 3001; // Change 3001 to your preferred port
```

**File Size Limit:**
```javascript
limits: {
  fileSize: 500 * 1024 * 1024 // 500MB - adjust as needed
}
```

**Whisper Model:**
```javascript
model: 'base' // Options: 'tiny', 'base', 'small', 'medium', 'large'
```

**Language:**
```javascript
language: null // Auto-detect, or set to 'en', 'es', 'fr', etc.
```

## 🔧 How It Works

### Upload Flow

1. **User uploads video** → Saved to `upload/` folder
2. **FFmpeg extracts audio** → Creates temporary .wav file
3. **Whisper transcribes audio** → Generates .vtt subtitle file
4. **Subtitle saved** → Stored in `subtitles/` folder
5. **Temporary files cleaned** → Audio file automatically deleted
6. **Response sent** → User gets video URL and subtitle URL

### Delete Flow

1. **User deletes video** → DELETE request to `/video/:name`
2. **Video file deleted** → Removed from `upload/` folder
3. **Subtitle file deleted** → Removed from `subtitles/` folder
4. **Response sent** → Confirmation of deletion

### Video Playback

1. **HTML5 video player** → Loads video from `/video/:name`
2. **Subtitle track** → Automatically loads from `/subtitle/:name`
3. **CC button** → Appears in video controls if subtitle exists
4. **User clicks CC** → Subtitles appear on video

## 📝 API Reference

### POST /upload

Upload a video and automatically generate subtitles.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body: `video` (file)

**Response:**
```json
{
  "success": true,
  "message": "Video uploaded and subtitles generated",
  "video": {
    "name": "video.mp4",
    "path": "/video/video.mp4",
    "subtitlePath": "/subtitle/video.vtt"
  }
}
```

### GET /video/:name

Serve video file for playback.

**Response:**
- Content-Type: `video/mp4`
- Body: Video file stream

### GET /subtitle/:name

Serve subtitle file.

**Response:**
- Content-Type: `text/vtt; charset=utf-8`
- Body: WebVTT file content

### GET /videos

List all uploaded videos.

**Response:**
```json
{
  "videos": [
    {
      "name": "video.mp4",
      "videoUrl": "/video/video.mp4",
      "subtitleUrl": "/subtitle/video.vtt",
      "hasSubtitle": true
    }
  ]
}
```

### DELETE /video/:name

Delete video and its subtitle.

**Response:**
```json
{
  "success": true,
  "message": "Video and subtitle deleted",
  "deleted": {
    "video": true,
    "subtitle": true
  }
}
```

## 🐛 Troubleshooting

### Subtitle Generation Fails

**Check FFmpeg:**
```bash
ffmpeg -version
```

**Check Whisper:**
```bash
whisper --version
```

**Check Video File:**
- Ensure video is not corrupted
- Try a different video format (MP4 recommended)
- Check file size (very large files may timeout)

### Video Not Playing

- Check browser console for errors
- Verify video format is supported (MP4, WebM, etc.)
- Check file exists in `upload/` folder
- Try different browser

### Folder Watcher Not Working

- Ensure watcher has read/write permissions
- Check folder paths are correct
- Restart watcher if needed
- Check console for error messages

### Port Already in Use

Change port in `server.js`:
```javascript
const PORT = process.env.PORT || 3002; // Use different port
```

## 📊 Performance Notes

- **Subtitle Generation Time:**
  - Tiny model: ~1-2 minutes per 10 minutes of video
  - Base model: ~3-5 minutes per 10 minutes of video
  - Small model: ~5-10 minutes per 10 minutes of video
  - Medium/Large: Much longer (not recommended for real-time)

- **Recommended Settings:**
  - Use "base" model for good balance of speed/accuracy
  - For faster processing, use "tiny" model
  - For better accuracy, use "small" or "medium" model

## 🔒 Security Notes

- This system is designed for local/development use
- For production, add:
  - Authentication/authorization
  - Rate limiting
  - File type validation
  - Size limits
  - CORS configuration
  - Input sanitization

## 📚 Additional Resources

- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [OpenAI Whisper GitHub](https://github.com/openai/whisper)
- [WebVTT Format](https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API)
- [HTML5 Video API](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement)

## ✅ Features Checklist

- ✅ Automatic subtitle generation on upload
- ✅ Video serving with subtitle support
- ✅ Automatic cleanup on deletion
- ✅ Folder watcher for auto-processing
- ✅ RESTful API
- ✅ Modern web interface
- ✅ Error handling
- ✅ Progress logging
- ✅ Temporary file cleanup
- ✅ ES module syntax
- ✅ Cross-platform support

## 🎉 You're All Set!

The system is ready to use. Upload a video and watch the magic happen! 🚀


