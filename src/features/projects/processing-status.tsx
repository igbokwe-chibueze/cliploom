'use client';
import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { jobFeedback, type WorkerState } from '@/lib/job-feedback';
import type { AppStatus, ProjectView } from './types';
const stages = ['validate', 'preview', 'extract-audio', 'transcribe', 'select-clips'];
const labels: Record<string, string> = { validate: 'Validate source', preview: 'Create preview', 'extract-audio': 'Extract audio', transcribe: 'Transcribe', 'select-clips': 'Find moments' };
export function ProcessingStatus({ project, status, retry, busy }: { project: ProjectView; status: AppStatus | null; retry: () => void; busy: boolean }) {
  const worker: WorkerState = status?.workerState ?? 'unknown';
  const job = project.jobs.find(j => j.type !== 'render');
  const feedback = jobFeedback(job, worker);
  const current = (job?.stage === 'queued' ? project.stage : job?.stage ?? project.stage).split(' ')[0];
  const index = project.status === 'completed' ? stages.length : stages.indexOf(current);
  return <div className="mb-7 rounded-xl border border-border p-4">
    <div className="flex flex-wrap items-center gap-x-7 gap-y-3">{stages.map((stage, i) => <span key={stage} className={`flex items-center gap-2 text-[11px] ${i <= index ? 'text-foreground' : 'text-muted-foreground'}`}>
      {i < index ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : i === index && feedback.active ? <LoaderCircle className="size-3.5 animate-spin text-primary" /> : <span className="size-3 rounded-full border border-current opacity-40" />}{labels[stage]}
    </span>)}</div>
    {project.status !== 'completed' && <div className="mt-4 border-t border-border pt-4" aria-live="polite" role="status">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="flex items-center gap-2 text-sm font-medium">{feedback.active && <LoaderCircle className="size-4 animate-spin text-primary" />}{job?.status === 'failed' && <AlertCircle className="size-4 text-red-600" />}{feedback.title}</p><p className="mt-2 text-xs leading-6 text-muted-foreground">{feedback.detail}</p></div>
        {job?.status === 'failed' && <Button size="sm" variant="outline" disabled={busy} onClick={retry}><RefreshCw />Retry saved stage</Button>}
      </div>
      {!!job?.attempts && <p className="mt-2 text-[11px] text-muted-foreground">Attempt {job.attempts}{status ? ` of ${status.maxJobAttempts}` : ''} · Completed stages are retained.</p>}
      {worker === 'recovering' && status?.recoveryAt && <p className="mt-2 text-[11px] text-muted-foreground">Previous lock expires at {new Date(status.recoveryAt).toLocaleTimeString()}. A waiting worker starts automatically.</p>}
    </div>}
    {project.jobs.filter(j => j.type === 'render' && ['queued', 'running', 'failed'].includes(j.status)).map(j => {
      const renderFeedback = jobFeedback(j, worker);
      return <div key={j.id} className="mt-4 border-t border-border pt-3 text-xs" role="status"><p className="font-medium">Export: {renderFeedback.title}</p><p className="mt-1 leading-6 text-muted-foreground">{renderFeedback.detail}</p>{j.status === 'failed' && <p className="mt-1">Select the clip and choose Retry export.</p>}</div>;
    })}
  </div>;
}
