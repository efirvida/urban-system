'use client';

import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
  title: string;
  /** Optional icon shown before the title in the header. */
  sidebarIcon?: ReactNode;
  subtitle?: string;
  children: ReactNode;
}

export default function Sidebar({
  open,
  onToggle,
  title,
  sidebarIcon,
  subtitle,
  children,
}: SidebarProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* Toggle button — always visible */}
      <button
        onClick={onToggle}
        aria-label={open ? t('sidebar.ariaLabels.closePanel') : t('sidebar.ariaLabels.openPanel')}
        className={cn(
          'fixed top-4 z-30 w-10 h-10 flex items-center justify-center rounded-full shadow-md transition-colors',
          'bg-white hover:bg-gray-100 border border-gray-200 text-gray-600',
        )}
        style={{
          left: open ? 'calc(min(420px, 90vw) + 16px)' : '16px',
          transition: 'left 0.3s ease',
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {open ? (
            // X icon
            <>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </>
          ) : (
            // Hamburger icon
            <>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </>
          )}
        </svg>
      </button>

      {/* Sidebar panel */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-20 h-full bg-white shadow-xl transition-all duration-300 ease-in-out flex flex-col',
          open ? 'w-[min(420px,90vw)]' : 'w-0 overflow-hidden',
        )}
      >
        {/* Header inside sidebar */}
        <div className="shrink-0 px-5 pt-14 pb-3 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900 leading-tight flex items-center gap-2">
            {sidebarIcon}
            {title}
          </h2>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </>
  );
}
