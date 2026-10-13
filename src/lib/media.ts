import { spawn } from 'node:child_process';
import { z } from 'zod';
import { config } from './config';

export async function runProcess(binary: string, args: string[], options: { cwd?: string; signal?: AbortSignal; timeout?: number } = {}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, windowsHide: true, cwd: options.cwd, signal: options.signal, env: { ...process.env, AV_LOG_FORCE_NOCOLOR: '1' } });
    let stdout = ''; let stderr = ''; let settled = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Media processing timed out. Try a shorter source.')); }, options.timeout ?? 30 * 60_000);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-2_000_000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
    child.on('error', () => { clearTimeout(timer); if (!settled) { settled = true; reject(new Error(`Cannot run ${binary === config.FFPROBE_PATH ? 'ffprobe' : 'ffmpeg'}. Check the configured path and run npm run doctor.`)); } });
    child.on('close', code => { clearTimeout(timer); if (settled) return; settled = true; if (code === 0) resolve(stdout || stderr); else reject(new Error(`Media processing failed (exit ${code}). Check that your FFmpeg build supports H.264, AAC, and the ass subtitle filter.`)); });
  });
}
const probeSchema = z.object({ format: z.object({ duration: z.coerce.number().positive(), format_name: z.string() }), streams: z.array(z.object({ codec_type: z.string(), width: z.number().optional(), height: z.number().optional(), avg_frame_rate: z.string().optional(), tags: z.record(z.string(), z.unknown()).optional(), side_data_list: z.array(z.object({ rotation: z.number().optional() })).optional() })) });
export async function probe(file: string, signal?: AbortSignal) {
  const data = probeSchema.parse(JSON.parse(await runProcess(config.FFPROBE_PATH, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-show_streams', '-of', 'json', file], { signal, timeout: 30_000 })));
  const video = data.streams.find(s => s.codec_type === 'video');
  if (!video?.width || !video.height || !data.streams.some(s => s.codec_type === 'audio')) throw new Error('Choose a video with a usable audio track. Silent videos are not supported.');
  if (!/(mov|mp4|webm|matroska)/.test(data.format.format_name)) throw new Error('Only MP4, MOV, or WebM media is supported.');
  const durationMs = Math.round(data.format.duration * 1000);
  if (durationMs > config.MAX_DURATION_MINUTES * 60_000) throw new Error(`Video exceeds the ${config.MAX_DURATION_MINUTES} minute limit.`);
  const rotation = video.side_data_list?.find(s => s.rotation !== undefined)?.rotation ?? Number(video.tags?.rotate ?? 0);
  const rotated = Math.abs(rotation) % 180 === 90;
  return { durationMs, width: rotated ? video.height : video.width, height: rotated ? video.width : video.height, rotation, frameRate: video.avg_frame_rate };
}
export async function checkTools() {
  const ffmpeg = await runProcess(config.FFMPEG_PATH, ['-hide_banner', '-version'], { timeout: 10_000 });
  await runProcess(config.FFPROBE_PATH, ['-version'], { timeout: 10_000 });
  const filters = await runProcess(config.FFMPEG_PATH, ['-hide_banner', '-filters'], { timeout: 10_000 });
  const encoders = await runProcess(config.FFMPEG_PATH, ['-hide_banner', '-encoders'], { timeout: 10_000 });
  if (!/\bass\b/.test(filters) || !encoders.includes('libx264') || !encoders.includes('aac')) throw new Error('FFmpeg needs the ass filter, libx264 and AAC encoders.');
  return ffmpeg.split('\n')[0];
}
