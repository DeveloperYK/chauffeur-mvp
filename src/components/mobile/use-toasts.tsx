'use client';
import { Icon } from '@/components/console/icons';
import { useCallback, useEffect, useRef, useState } from 'react';

interface Toast {
  id: string;
  text: string;
  action?: { label: string; onClick: () => void };
}

const TOAST_TTL_MS = 2800;

/** Same toast stack as the board, scoped to one mobile screen. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (text: string, opts: { action?: Toast['action']; ttlMs?: number } = {}) => {
      const id = crypto.randomUUID();
      setToasts((t) => [...t, { id, text, ...(opts.action ? { action: opts.action } : {}) }]);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        dismiss(id);
      }, opts.ttlMs ?? TOAST_TTL_MS);
      timers.current.add(timer);
      return id;
    },
    [dismiss],
  );

  const stack = (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <Icon.Check /> {t.text}
          {t.action ? (
            <button type="button" className="toast__btn" onClick={t.action.onClick}>
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );

  return { push, dismiss, stack };
}
