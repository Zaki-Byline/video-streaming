# Automated Video + Subtitle Management System

A fully automated Node.js system for video upload, playback, and automatic subtitle generation using FFmpeg and OpenAI Whisper.

## Features

- ✅ **Automatic Subtitle Generation**: Upload a video and get subtitles automatically
- ✅ **Video Playback**: Serve videos with subtitle support
- ✅ **Automatic Cleanup**: Delete video and subtitle together
- ✅ **Folder Watcher**: Optional automatic processing of new videos
- ✅ **RESTful API**: Clean API endpoints for integration
- ✅ **Modern Frontend**: Beautiful HTML interface with video player

## Prerequisites

1. **Node.js** (v18 or higher)
2. **FFmpeg** - [Download here](https://ffmpeg.org/download.html)
3. **OpenAI Whisper** - Install via pip:
   ```bash
   pip install openai-whisper
   ```

## Installation

1. **Install dependencies:**
   ```bash
   cd backend/automated-video-system
   npm install
   ```

2. **Verify FFmpeg and Whisper:**
   ```bash
   ffmpeg -version
   whisper --version
   ```

## Usage

### Option 1: Start Server Only

```bash
npm start
```

This starts the server on `http://localhost:3001` with:
- Upload endpoint
- Video serving
- Subtitle serving
- Delete functionality
- Web interface

### Option 2: Start Server + Folder Watcher

**Terminal 1 - Server:**
```bash
npm start
```

**Terminal 2 - Folder Watcher:**
```bash
npm run watch
```

The folder watcher automatically generates subtitles for any new video files added to the `upload/` folder.

## API Endpoints

### POST /upload
Upload a video file and automatically generate subtitles.

**Request:**
```bash
curl -X POST -F "video=@your-video.mp4" http://localhost:3001/upload
```

**Response:**
```json
{
  "success": true,
  "message": "Video uploaded and subtitles generated",
  "video": {
    "name": "your-video.mp4",
    "path": "/video/your-video.mp4",
    "subtitlePath": "/subtitle/your-video.vtt"
  }
}
```

### GET /video/:name
Serve video file for playback.

**Example:**
```
http://localhost:3001/video/your-video.mp4
```

### GET /subtitle/:name
Serve subtitle file (.vtt).

**Example:**
```
http://localhost:3001/subtitle/your-video.vtt
```

### GET /videos
List all uploaded videos with their subtitle status.

**Response:**
```json
{
  "videos": [
    {
      "name": "your-video.mp4",
      "videoUrl": "/video/your-video.mp4",
      "subtitleUrl": "/subtitle/your-video.vtt",
      "hasSubtitle": true
    }
  ]
}
```

### DELETE /video/:name
Delete video and its associated subtitle.

**Request:**
```bash
curl -X DELETE http://localhost:3001/video/your-video.mp4
```

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

## Folder Structure

```
video-streaming/
├── upload/              # Video files stored here
│   └── your-video.mp4
├── subtitles/           # Auto-generated subtitle files
│   └── your-video.vtt
└── backend/
    └── automated-video-system/
        ├── server.js           # Main server
        ├── folderWatcher.js    # Optional folder watcher
        ├── package.json
        └── public/
            └── index.html      # Web interface
```

## Frontend Usage

1. Open `http://localhost:3001` in your browser
2. Click "Choose File" and select a video
3. Click "Upload & Generate Subtitles"
4. Wait for upload and subtitle generation (may take several minutes)
5. Video will appear in the list with subtitle support

## How It Works

1. **Upload**: Video is saved to `upload/` folder
2. **Audio Extraction**: FFmpeg extracts audio from video
3. **Transcription**: Whisper transcribes audio to text
4. **Subtitle Generation**: Creates WebVTT (.vtt) file
5. **Storage**: Subtitle saved to `subtitles/` folder
6. **Cleanup**: Temporary audio files are automatically deleted

## Configuration

Edit `server.js` to customize:

- **Port**: Change `PORT` variable (default: 3001)
- **Upload Limit**: Change `fileSize` limit in multer config
- **Whisper Model**: Change `model: 'base'` to `'tiny'`, `'small'`, `'medium'`, or `'large'`
- **Language**: Set `language: 'en'` for English, or `null` for auto-detect

## Troubleshooting

### Subtitle generation fails
- Check FFmpeg is installed: `ffmpeg -version`
- Check Whisper is installed: `whisper --version`
- Check video file is not corrupted
- Check sufficient disk space

### Video not playing
- Check video format is supported (MP4, WebM, etc.)
- Check browser console for errors
- Verify video file exists in `upload/` folder

### Folder watcher not working
- Ensure watcher has read/write permissions
- Check folder path is correct
- Restart watcher if needed

## Notes

- Subtitle generation can take several minutes for long videos
- The system uses Whisper's "base" model by default (good balance of speed/accuracy)
- Temporary audio files are automatically cleaned up
- Videos and subtitles are deleted together for data consistency

## License

ISC


