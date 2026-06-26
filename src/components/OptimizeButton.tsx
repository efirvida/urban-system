'use client';

import { Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OptimizeButtonProps {
  onClick: () => void;
  loading: boolean;
  disabled?: boolean;
}

export default function OptimizeButton({ onClick, loading, disabled }: OptimizeButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn('btn-primary w-full text-base py-3', loading && 'opacity-75')}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
          Optimizando...
        </span>
      ) : (
        <span className="flex items-center justify-center gap-2">
          <Rocket className="w-4 h-4" aria-hidden="true" />
          Optimizar Rutas
        </span>
      )}
    </button>
  );
}
