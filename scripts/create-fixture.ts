import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/lib/config';
import { runProcess } from '../src/lib/media';
export async function createFixture() {
  const file = path.resolve('tests/fixtures/source video.mp4'); await mkdir(path.dirname(file), { recursive: true });
  await runProcess(config.FFMPEG_PATH, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
  return file;
}
if (process.argv[1]?.endsWith('create-fixture.ts')) createFixture().then(file => console.log(`Synthetic test video (tone, not speech): ${file}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
