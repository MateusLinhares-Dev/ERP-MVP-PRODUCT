import { useCallback, useRef, useState } from 'react';

export type ToastTone = 'info' | 'error' | 'success';

export interface ToastMessage {
  text: string;
  tone: ToastTone;
}

export interface ToastControls {
  toast: ToastMessage | null;
  notify(text: string, tone?: ToastTone, durationMs?: number): void;
  dismiss(): void;
}

const DEFAULT_DURATION_MS = 4500;

export function useToast(): ToastControls {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);

  const notify = useCallback((text: string, tone: ToastTone = 'info', durationMs = DEFAULT_DURATION_MS) => {
    window.clearTimeout(timer.current);
    setToast({ text, tone });
    timer.current = window.setTimeout(() => setToast(null), durationMs);
  }, []);

  return { toast, notify, dismiss };
}
