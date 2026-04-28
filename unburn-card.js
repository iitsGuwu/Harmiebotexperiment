import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

const FIRE_GIF_PATH = path.resolve(process.cwd(), 'assets', 'unburn-fire.gif');
const OUTPUT_WIDTH = 640;
const OUTPUT_HEIGHT = 640;
const FIRE_HEIGHT = 360;
const HARMIE_SIZE = 460;
const HARMIE_OFFSET_Y = 100;

export async function renderUnburnCard({ imagePath }) {
  await access(FIRE_GIF_PATH);
  await access(imagePath);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'harmie-unburn-'));
  const outputPath = path.join(tempDir, 'unburn.gif');

  // Composite the burnt Harmie over the looping fire gif. No text overlay — just the moment.
  const filterGraph = [
    `[0:v]scale=${OUTPUT_WIDTH}:${FIRE_HEIGHT}:flags=lanczos,pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:0:${OUTPUT_HEIGHT - FIRE_HEIGHT}:color=0x090909[bg]`,
    `[1:v]scale=${HARMIE_SIZE}:${HARMIE_SIZE}:force_original_aspect_ratio=decrease[fg]`,
    `[bg][fg]overlay=(W-w)/2:${HARMIE_OFFSET_Y}[stacked]`,
    `[stacked]split[final][palette]`,
    `[palette]palettegen=stats_mode=full[p]`,
    `[final][p]paletteuse=dither=sierra2_4a`,
  ].join(';');

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      FIRE_GIF_PATH,
      '-i',
      imagePath,
      '-filter_complex',
      filterGraph,
      '-loop',
      '0',
      outputPath,
    ]);

    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
