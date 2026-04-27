# Quick Start Guide

## Current Status

You're generating subtitles for videos. Once complete, you can use this automated system.

## Correct Navigation

Since you're already in `backend/`, use:

```powershell
cd automated-video-system
```

**NOT** `cd backend/automated-video-system` (that would try to go to `backend/backend/automated-video-system`)

## Quick Start Steps

### 1. Navigate to the folder
```powershell
cd C:\Users\ADMIN\Downloads\video-streaming\backend\automated-video-system
```

### 2. Install dependencies
```powershell
npm install
```

### 3. Start the server
```powershell
npm start
```

The server will start on `http://localhost:3001`

### 4. Open in browser
```
http://localhost:3001
```

## What This System Does

- **Upload videos** through web interface or API
- **Automatically generates subtitles** using FFmpeg + Whisper
- **Serves videos** with subtitle support
- **Deletes videos and subtitles** together

## Folder Structure

```
video-streaming/
├── upload/              # Videos go here
├── subtitles/           # Subtitles go here
└── backend/
    └── automated-video-system/  # This system
```

## Note About Your Current Subtitle Generation

You're currently running `npm run generate-all-subtitles` which:
- Generates subtitles in `backend/subtitles/`
- Uses the batch script

The automated system uses:
- `upload/` folder (at project root)
- `subtitles/` folder (at project root)

These are different from `backend/upload/` and `backend/subtitles/`.

## Using the Automated System

Once you start the server:
1. Open `http://localhost:3001`
2. Upload a video through the web interface
3. Subtitles will be generated automatically
4. Video will appear in the list with subtitle support

## API Usage

**Upload:**
```powershell
curl -X POST -F "video=@video.mp4" http://localhost:3001/upload
```

**List videos:**
```powershell
curl http://localhost:3001/videos
```

**Delete video:**
```powershell
curl -X DELETE http://localhost:3001/video/video.mp4
```


