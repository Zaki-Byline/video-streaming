import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { isOpenAiConfigured } from '../config/loadEnv.js';
import { getOpenAIClient, formatOpenAIError } from './openaiClient.js';
import { resolveFfmpegPath } from './resolveFfmpeg.js';

const execAsync = promisify(exec);
const WHISPER_MAX_BYTES = 24 * 1024 * 1024; // 25 MB API limit, use 24 MB buffer

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

async function transcribeWithLocalWhisper(audioPath, model, language) {
  const isWindows = process.platform === 'win32';
  const escapedAudioPath = isWindows ? audioPath.replace(/"/g, '\\"') : audioPath;
  const outputDir = path.dirname(audioPath);
  const escapedOutputDir = isWindows ? outputDir.replace(/"/g, '\\"') : outputDir;

  let command = `whisper "${escapedAudioPath}" --model ${model} --output_format vtt --output_dir "${escapedOutputDir}"`;
  if (language) command += ` --language ${language}`;

  await execAsync(command);

  const audioName = path.basename(audioPath, path.extname(audioPath));
  return path.join(outputDir, `${audioName}.vtt`);
}

async function compressAudioForWhisper(audioPath) {
  const stats = fs.statSync(audioPath);
  if (stats.size <= WHISPER_MAX_BYTES) {
    return audioPath;
  }

  const ffmpegBin = await resolveFfmpegPath();
  const quotedFfmpeg = ffmpegBin.includes(' ') ? `"${ffmpegBin}"` : ffmpegBin;
  const mp3Path = audioPath.replace(/\.wav$/i, '_whisper.mp3');

  console.log(
    `[transcribe] Audio ${(stats.size / 1024 / 1024).toFixed(1)} MB — compressing for Whisper API limit`
  );

  await execAsync(
    `${quotedFfmpeg} -i "${audioPath}" -ac 1 -ar 16000 -b:a 48k "${mp3Path}" -y`
  );

  return mp3Path;
}

async function transcribeWithOpenAI(audioPath) {
  if (!isOpenAiConfigured()) {
    throw new Error('OPENAI_API_KEY is required for cloud transcription when local Whisper is not installed.');
  }

  const uploadPath = await compressAudioForWhisper(audioPath);
  const uploadSize = fs.statSync(uploadPath).size;

  if (uploadSize > WHISPER_MAX_BYTES) {
    throw new Error(
      `Audio is ${(uploadSize / 1024 / 1024).toFixed(1)} MB after compression — exceeds OpenAI Whisper 25 MB limit. ` +
      'Upload a VTT subtitle file manually or use a shorter video.'
    );
  }

  try {
    const openai = getOpenAIClient();
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(uploadPath),
      model: 'whisper-1',
      response_format: 'vtt'
    });

    const outputDir = path.dirname(audioPath);
    const audioName = path.basename(audioPath, path.extname(audioPath));
    const vttPath = path.join(outputDir, `${audioName}.vtt`);
    await fs.promises.writeFile(vttPath, transcription, 'utf8');

    if (uploadPath !== audioPath && fs.existsSync(uploadPath)) {
      fs.unlinkSync(uploadPath);
    }

    return vttPath;
  } catch (error) {
    throw new Error(formatOpenAIError(error));
  }
}

/**
 * Transcribe audio to VTT — local Whisper if available, else OpenAI Whisper API.
 */
export async function transcribeAudioToVtt(audioPath, options = {}) {
  const { model = 'base', language = null } = options;

  if (await commandExists('whisper')) {
    return transcribeWithLocalWhisper(audioPath, model, language);
  }

  if (isOpenAiConfigured()) {
    console.log('[transcribe] Local Whisper not found — using OpenAI Whisper API');
    return transcribeWithOpenAI(audioPath);
  }

  throw new Error(
    'Whisper is not installed and OPENAI_API_KEY is not set. ' +
    'Install: pip install openai-whisper — or set OPENAI_API_KEY for cloud transcription.'
  );
}
