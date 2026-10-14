'use client';
import { useEffect, useState } from 'react';
import { api, type AppStatus } from './types';
export function useAppStatus() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  useEffect(() => {
    let mounted = true;
    const refresh = () => api<AppStatus>('/api/status').then(s => { if (mounted) setStatus(s); }).catch(() => { if (mounted) setStatus(null); });
    refresh(); const timer = setInterval(refresh, 3000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);
  return status;
}
