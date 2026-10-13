import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });
const bundledFfmpeg = path.resolve('node_modules/ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const bundledFfprobe = path.resolve('node_modules/ffprobe-static/bin', process.platform, process.arch, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
const env = z.object({
  AI_MODE: z.enum(['live', 'fixture']).default('live'),
  DATABASE_URL: z.string().default('file:./data/cliploom.db'),
  MEDIA_STORAGE_DIR: z.string().default('./data/media'),
  FFMPEG_PATH: z.string().default(''),
  FFPROBE_PATH: z.string().default(''),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(1024),
  MAX_DURATION_MINUTES: z.coerce.number().positive().default(120),
  AUDIO_CHUNK_SECONDS: z.coerce.number().min(15).max(600).default(300),
  PROVIDER_MAX_FILE_MB: z.coerce.number().positive().max(25).default(24),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  JOB_LEASE_SECONDS: z.coerce.number().min(30).default(90),
  CLIP_COUNT: z.coerce.number().int().min(1).max(10).default(5),
  TRANSCRIPTION_MODEL: z.string().default('whisper-large-v3-turbo'),
  CLIP_SELECTION_MODEL: z.string().default('gemini-2.5-flash-lite'),
  LOCAL_ORIGIN: z.string().url().default('http://localhost:3000'),
  GROQ_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
}).parse(process.env);
if (!env.DATABASE_URL.startsWith('file:')) throw new Error('DATABASE_URL must be a local SQLite file URL.');
export const config = {
  ...env,
  FFMPEG_PATH: env.FFMPEG_PATH || (existsSync(bundledFfmpeg) ? bundledFfmpeg : 'ffmpeg'),
  FFPROBE_PATH: env.FFPROBE_PATH || (existsSync(bundledFfprobe) ? bundledFfprobe : 'ffprobe'),
  databaseUrl: `file:${path.resolve(env.DATABASE_URL.slice(5)).replaceAll('\\', '/')}`,
  storageDir: path.resolve(env.MEDIA_STORAGE_DIR),
  maxUploadBytes: Math.floor(env.MAX_UPLOAD_MB * 1024 * 1024),
};
