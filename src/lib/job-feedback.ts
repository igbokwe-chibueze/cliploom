export type WorkerState = 'online' | 'recovering' | 'offline' | 'unknown';
export function workerHealth(leaseUntil: Date | string | null | undefined, leaseSeconds: number, now = Date.now()) {
  const expires = leaseUntil ? new Date(leaseUntil).getTime() : 0;
  const heartbeat = expires - leaseSeconds * 1000;
  return { workerOnline: expires > now && now - heartbeat <= 10_000,
    workerState: (expires <= now ? 'offline' : now - heartbeat > 10_000 ? 'recovering' : 'online') as WorkerState,
    lastHeartbeatAt: expires ? new Date(heartbeat).toISOString() : null,
    recoveryAt: expires > now ? new Date(expires).toISOString() : null };
}
export type JobFeedbackInput = { status: string; stage: string; attempts: number; runAfter: string; error: string | null };
export function jobFeedback(job: JobFeedbackInput | undefined, worker: WorkerState, now = Date.now()) {
  if (!job) return { title: 'Waiting for processing', detail: 'No active processing job.', active: false };
  if (job.status === 'failed') return { title: 'Processing paused', detail: job.error ?? 'The job failed. Retry the saved stage.', active: false };
  if (job.status === 'succeeded') return { title: 'Processing complete', detail: 'Review your suggestions before exporting.', active: false };
  if (job.status === 'cancelled') return { title: 'Processing cancelled', detail: 'This job is no longer running.', active: false };
  if (worker !== 'online') return { title: worker === 'recovering' ? 'Recovering the worker' : worker === 'unknown' ? 'Checking the worker' : 'Waiting for the worker', detail: worker === 'recovering' ? 'The last heartbeat stopped. A restarted worker will resume saved stages when the previous lease expires.' : worker === 'unknown' ? 'Worker status could not be confirmed. Your saved job is retained.' : 'Processing is paused. Start npm.cmd run dev or npm.cmd run worker; this job will be picked up automatically.', active: false };
  if (job.status === 'queued' && job.error && job.attempts > 0) {
    const seconds = Math.max(0, Math.ceil((new Date(job.runAfter).getTime() - now) / 1000));
    return { title: 'Waiting to retry', detail: `${job.error} ${seconds ? `Next attempt in ${seconds} seconds.` : 'The next attempt is ready to start.'}`, active: false };
  }
  if (job.status === 'queued') return { title: 'Queued for processing', detail: 'The worker is online. Your job is waiting its turn.', active: false };
  return { title: 'Processing your video', detail: `Current stage: ${stageLabel(job.stage)}. You can leave this page; the worker will continue.`, active: true };
}
export function stageLabel(stage: string) {
  const [name, chunk] = stage.split(' ');
  const labels: Record<string, string> = { validate: 'Validating source', preview: 'Creating preview', 'extract-audio': 'Extracting audio', transcribe: 'Transcribing speech', 'select-clips': 'Finding moments', render: 'Rendering export', queued: 'Waiting in queue', completed: 'Completed' };
  return `${labels[name] ?? name}${chunk ? ` (chunk ${chunk})` : ''}`;
}
