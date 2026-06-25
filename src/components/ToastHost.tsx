'use client';

import { X, Info, AlertCircle } from 'lucide-react';
import { useEffect } from 'react';
import { useToastHost, type ToastItem } from '@/lib/toast';

/**
 * Fixed-position host that renders every active toast.
 *
 * - Top-right, `z-50` so it floats over the map and the sidebar.
 * - Auto-dismisses each toast after its `durationMs`.
 * - Manual close via the × button.
 * - Two kinds: `error` (red) and `info` (blue).
 */
export default function ToastHost() {
  const { items, dismiss } = useToastHost();

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
    >
      {items.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  // Auto-dismiss timer — clears when the item unmounts or the deps change.
  useEffect(() => {
    if (item.durationMs <= 0) return;
    const timer = setTimeout(() => onDismiss(item.id), item.durationMs);
    return () => clearTimeout(timer);
  }, [item.id, item.durationMs, onDismiss]);

  const isError = item.kind === 'error';
  const Icon = isError ? AlertCircle : Info;

  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={
        'pointer-events-auto flex items-start gap-2 min-w-[260px] max-w-md px-4 py-2.5 ' +
        'rounded-lg shadow-lg border text-sm animate-slide-down ' +
        (isError
          ? 'bg-red-50 border-red-200 text-red-700'
          : 'bg-blue-50 border-blue-200 text-blue-700')
      }
    >
      <Icon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span className="flex-1 break-words">{item.msg}</span>
      <button
        onClick={() => onDismiss(item.id)}
        aria-label="Close"
        className={
          'shrink-0 inline-flex items-center ' +
          (isError ? 'text-red-400 hover:text-red-600' : 'text-blue-400 hover:text-blue-600')
        }
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
