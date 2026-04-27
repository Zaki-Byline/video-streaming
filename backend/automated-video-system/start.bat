@echo off
REM Quick Start Script for Automated Video System (Windows)

echo 🚀 Starting Automated Video + Subtitle System...
echo.

REM Check if FFmpeg is installed
where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ FFmpeg is not installed!
    echo    Please install FFmpeg: https://ffmpeg.org/download.html
    pause
    exit /b 1
)
echo ✅ FFmpeg found

REM Check if Whisper is installed
where whisper >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Whisper is not installed!
    echo    Please install: pip install openai-whisper
    pause
    exit /b 1
)
echo ✅ Whisper found

REM Check if node_modules exists
if not exist "node_modules" (
    echo 📦 Installing dependencies...
    call npm install
)

echo.
echo 🌐 Starting server...
echo    Frontend: http://localhost:3001
echo    API: http://localhost:3001
echo.
echo 💡 Press Ctrl+C to stop
echo.

call npm start


