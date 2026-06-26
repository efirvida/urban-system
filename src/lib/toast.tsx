'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/** Visual style + semantic of a single toast. */
export type ToastKind = 'error' | 'info';

export interface ToastOpts {
  kind?: ToastKind;
  /** Auto-dismiss timeout in ms. Default 4000. */
  durationMs?: number;
}

/** Internal record kept by the provider. */
export interface ToastItem extends Required<Omit<ToastOpts, 'durationMs'>> {
  id: string;
  msg: string;
  durationMs: number;
}

interface ToastContextValue {
  /** Show a toast. Returns the assigned id so callers can dismiss early. */
  show: (msg: string, opts?: ToastOpts) => string;
  /** Dismiss a specific toast by id (manual close from the host). */
  dismiss: (id: string) => void;
  /** Active toasts, newest last. */
  items: ToastItem[];
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 4000;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `t-${Date.now().toString(36)}-${counter}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((msg: string, opts: ToastOpts = {}): string => {
    const id = nextId();
    const item: ToastItem = {
      id,
      msg,
      kind: opts.kind ?? 'info',
      durationMs: opts.durationMs ?? DEFAULT_DURATION_MS,
    };
    setItems((prev) => [...prev, item]);
    return id;
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ show, dismiss, items }),
    [show, dismiss, items],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): { show: ToastContextValue['show'] } {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Outside a provider — degrade gracefully so non-wrapped parts of
    // the app (e.g. tests, server-rendered children) don't throw.
    return { show: () => '' };
  }
  return { show: ctx.show };
}

/** Read-only access to the toast list + dismiss — used by `<ToastHost>`. */
export function useToastHost(): { items: ToastItem[]; dismiss: ToastContextValue['dismiss'] } {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return { items: [], dismiss: () => {} };
  }
  return { items: ctx.items, dismiss: ctx.dismiss };
}
