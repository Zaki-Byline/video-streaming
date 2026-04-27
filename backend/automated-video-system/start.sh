#!/bin/bash

# Quick Start Script for Automated Video System

echo "🚀 Starting Automated Video + Subtitle System..."
echo ""

# Check if FFmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo "❌ FFmpeg is not installed!"
    echo "   Please install FFmpeg: https://ffmpeg.org/download.html"
    exit 1
fi
echo "✅ FFmpeg found"

# Check if Whisper is installed
if ! command -v whisper &> /dev/null; then
    echo "❌ Whisper is not installed!"
    echo "   Please install: pip install openai-whisper"
    exit 1
fi
echo "✅ Whisper found"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

echo ""
echo "🌐 Starting server..."
echo "   Frontend: http://localhost:3001"
echo "   API: http://localhost:3001"
echo ""
echo "💡 Press Ctrl+C to stop"
echo ""

npm start


