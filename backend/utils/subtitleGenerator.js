/**
 * Subtitle Generator Utility
 * 
 * Provides programmatic access to subtitle generation
 * Can be used in API endpoints or other Node.js scripts
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate subtitles for a video file
 * 
 * @param {string} videoPath - Path to the video file
 * @param {Object} options - Generation options
 * @param {string} options.outputPath - Output VTT file path (optional)
 * @param {string} options.model - Whisper model size: tiny, base, small, medium, large (default: base)
 * @param {string} options.language - Language code (e.g., 'en', 'es', 'fr'). Auto-detect if null
 * @returns {Promise<string>} Path to the generated VTT file
 */
export async function generateSubtitles(videoPath, options = {}) {
  const {
    outputPath = null,
    model = 'base',
    language = null
  } = options;

  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  // Set default output path if not provided
  let finalOutputPath = outputPath;
  if (!finalOutputPath) {
    const videoName = path.basename(videoPath, path.extname(videoPath));
    const videoDir = path.dirname(videoPath);
    finalOutputPath = path.join(videoDir, `${videoName}.vtt`);
  }

  // Temporary audio file path
  const tempAudioPath = path.join(path.dirname(videoPath), `temp_audio_${Date.now()}.wav`);

  try {
    // Step 1: Extract audio
    await extractAudio(videoPath, tempAudioPath);

    // Step 2: Transcribe with Whisper
    const whisperOutputPath = await transcribeAudio(tempAudioPath, model, language);

    // Step 3: Move VTT file to desired location
    if (whisperOutputPath !== finalOutputPath) {
      await moveVttFile(whisperOutputPath, finalOutputPath);
    }

    // Clean up temporary audio file
    if (existsSync(tempAudioPath)) {
      unlinkSync(tempAudioPath);
    }

    return finalOutputPath;
  } catch (error) {
    // Clean up on error
    if (existsSync(tempAudioPath)) {
      try {
        unlinkSync(tempAudioPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    throw error;
  }
}

/**
 * Check if a command exists
 */
async function commandExists(command) {
  try {
    const isWindows = process.platform === 'win32';
    const checkCommand = isWindows ? `where ${command}` : `which ${command}`;
    await execAsync(checkCommand);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract audio from video using FFmpeg
 */
async function extractAudio(videoPath, audioPath) {
  if (!(await commandExists('ffmpeg'))) {
    throw new Error('FFmpeg is not installed. Please install FFmpeg first.');
  }

  // Extract audio as WAV format (16kHz mono, which works well with Whisper)
  const isWindows = process.platform === 'win32';
  const escapedVideoPath = isWindows ? videoPath.replace(/"/g, '\\"') : videoPath;
  const escapedAudioPath = isWindows ? audioPath.replace(/"/g, '\\"') : audioPath;
  
  const command = `ffmpeg -i "${escapedVideoPath}" -ar 16000 -ac 1 -f wav "${escapedAudioPath}" -y`;
  
  try {
    await execAsync(command);
    return true;
  } catch (error) {
    throw new Error(`FFmpeg error: ${error.message}`);
  }
}

/**
 * Transcribe audio using Whisper
 */
async function transcribeAudio(audioPath, model, language) {
  if (!(await commandExists('whisper'))) {
    throw new Error('Whisper is not installed. Please install OpenAI Whisper first.');
  }

  // Build Whisper command
  const isWindows = process.platform === 'win32';
  const escapedAudioPath = isWindows ? audioPath.replace(/"/g, '\\"') : audioPath;
  const outputDir = path.dirname(audioPath);
  const escapedOutputDir = isWindows ? outputDir.replace(/"/g, '\\"') : outputDir;
  
  let command = `whisper "${escapedAudioPath}" --model ${model} --output_format vtt --output_dir "${escapedOutputDir}"`;
  
  if (language) {
    command += ` --language ${language}`;
  }

  try {
    await execAsync(command);
    
    // Whisper outputs file as <audio-name>.vtt in the same directory
    const audioName = path.basename(audioPath, path.extname(audioPath));
    const whisperOutputPath = path.join(outputDir, `${audioName}.vtt`);
    
    return whisperOutputPath;
  } catch (error) {
    throw new Error(`Whisper error: ${error.message}`);
  }
}

/**
 * Move and rename the VTT file to the desired output path
 */
async function moveVttFile(sourcePath, destPath) {
  const fs = await import('fs/promises');
  try {
    await fs.copyFile(sourcePath, destPath);
    await fs.unlink(sourcePath); // Remove temporary file
  } catch (error) {
    throw new Error(`Error moving VTT file: ${error.message}`);
  }
}

/**
 * Check if required tools are installed
 * @returns {Promise<Object>} Status of required tools
 */
export async function checkDependencies() {
  const ffmpegInstalled = await commandExists('ffmpeg');
  const whisperInstalled = await commandExists('whisper');

  return {
    ffmpeg: ffmpegInstalled,
    whisper: whisperInstalled,
    allInstalled: ffmpegInstalled && whisperInstalled
  };
}



