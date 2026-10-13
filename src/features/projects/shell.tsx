'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Clapperboard, Moon, Sun, ArrowUpRight, FlaskConical } from 'lucide-react';
import { brand } from '@/lib/brand';
import { Button } from '@/components/ui/button';
import { api, type AppStatus } from './types';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false); const [status, setStatus] = useState<AppStatus | null>(null);
  useEffect(() => { const enabled = localStorage.getItem('theme') === 'dark'; document.documentElement.classList.toggle('dark', enabled); const id = setTimeout(() => setDark(enabled), 0); const refresh = () => api<AppStatus>('/api/status').then(setStatus).catch(() => {}); refresh(); const interval = setInterval(refresh, 5000); return () => { clearTimeout(id); clearInterval(interval); }; }, []);
  function toggle() { const next = !dark; setDark(next); document.documentElement.classList.toggle('dark', next); localStorage.setItem('theme', next ? 'dark' : 'light'); }
  return <div className="min-h-screen bg-background text-foreground">
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-18 max-w-[1480px] items-center justify-between gap-4 px-5 md:px-9">
        <div className="flex items-center gap-8"><Link href="/" className="flex items-center gap-2.5 text-xl font-bold tracking-tight"><span className="flex size-9 items-center justify-center rounded-xl bg-primary text-white"><Clapperboard size={20} /></span>{brand.name}<span className="hidden rounded border border-border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest text-muted-foreground sm:block">Local</span></Link><Link href="/" className="hidden text-sm font-medium text-muted-foreground hover:text-foreground md:block">Workspace</Link></div>
        <div className="flex items-center gap-3"><span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className={`size-1.5 rounded-full ${status?.workerOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />Worker {status?.workerOnline ? 'online' : 'offline'}</span><Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>{dark ? <Sun /> : <Moon />}</Button><span className="flex size-8 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold">ME</span></div>
      </div>
    </header>
    {status?.mode === 'fixture' && <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-center text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"><FlaskConical className="mr-1.5 inline size-3.5" />Fixture mode · Synthetic transcripts and suggestions. Video processing and exports are real.</div>}
    <main className="mx-auto max-w-[1480px] px-5 py-9 md:px-9">{children}</main>
    <footer className="mx-auto flex max-w-[1480px] items-center justify-between gap-3 px-5 py-6 text-xs text-muted-foreground md:px-9"><span>{brand.name} · Your local editing workspace</span><span className="flex items-center gap-1">Single-user prototype <ArrowUpRight size={12} /></span></footer>
  </div>;
}
export function StatusPill({ status }: { status: string }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${['completed', 'succeeded'].includes(status) ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : status === 'failed' ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-muted text-muted-foreground'}`}><span className="size-1 rounded-full bg-current" />{status === 'completed' ? 'Ready' : status.charAt(0).toUpperCase() + status.slice(1)}</span>;
}
