import { exec } from 'child_process';
import { promisify } from 'util';
import { accessSync, constants } from 'fs';
import ffmpegStatic from 'ffmpeg-static';

const execAsync = promisify(exec);

function pathExists(filePath) {
  try {
    accessSync(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve FFmpeg binary: valid FFMPEG_PATH → system PATH → ffmpeg-static bundle.
 */
export async function resolveFfmpegPath() {
  if (process.env.FFMPEG_PATH && pathExists(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }

  if (await commandOnPath('ffmpeg')) {
    return 'ffmpeg';
  }

  if (ffmpegStatic && pathExists(ffmpegStatic)) {
    return ffmpegStatic;
  }

  throw new Error(
    'FFmpeg is not available. Install FFmpeg, set a valid FFMPEG_PATH, or run: npm install ffmpeg-static'
  );
}

async function commandOnPath(command) {
  try {
    const isWindows = process.platform === 'win32';
    const checkCommand = isWindows ? `where ${command}` : `which ${command}`;
    await execAsync(checkCommand);
    return true;
  } catch {
    return false;
  }
}

export async function isFfmpegAvailable() {
  try {
    await resolveFfmpegPath();
    return true;
  } catch {
    return false;
  }
}
