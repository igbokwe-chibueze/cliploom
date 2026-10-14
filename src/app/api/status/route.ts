import { workerHealth } from '@/lib/job-feedback';
import { config } from '@/lib/config';
import { db } from '@/lib/db';
import { requireLocal, errorResponse } from '@/lib/server-api';
export async function GET(request: Request) {
  try {
    requireLocal(request);
    const lock = await db.workerLock.findUnique({ where: { id: 'single' } });
    return Response.json({ mode: config.AI_MODE, maxUploadMB: config.MAX_UPLOAD_MB, maxDurationMinutes: config.MAX_DURATION_MINUTES, defaultClipCount: config.CLIP_COUNT, ...workerHealth(lock?.leaseUntil, config.JOB_LEASE_SECONDS), maxJobAttempts: config.JOB_MAX_ATTEMPTS, keysConfigured: !!config.GROQ_API_KEY && !!config.GEMINI_API_KEY });
  } catch (error) { return errorResponse(error); }
}
