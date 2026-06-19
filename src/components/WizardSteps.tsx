"use client";

import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** A single wizard step in the 5-phase progress bar. */
export interface WizardPhase {
  /** Stable id used to identify the phase (e.g. `"upload"`, `"results"`). */
  key: string;
  /** Spanish label shown in the pill. */
  label: string;
  /** Lucide icon component rendered before the label. */
  Icon: LucideIcon;
}

interface WizardStepsProps {
  /** All phases, in display order. */
  phases: readonly WizardPhase[];
  /** Index of the active phase. */
  currentIdx: number;
  /**
   * Optional click handler. Past steps (idx < currentIdx) are clickable;
   * future steps are inert. Omit to render a read-only indicator.
   */
  onStepClick?: (index: number) => void;
}

/**
 * 5-step pill bar extracted from `page.tsx`.
 *
 * Renders each phase as a small pill: the active step is filled in
 * brand blue, past steps are green, future steps are grey. Past steps
 * are clickable when `onStepClick` is provided — useful when the user
 * wants to navigate back without resetting the whole flow.
 */
export default function WizardSteps({
  phases,
  currentIdx,
  onStepClick,
}: WizardStepsProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {phases.map((p, i) => {
        const isActive = i === currentIdx;
        const isPast = i < currentIdx;
        const isClickable = isPast && Boolean(onStepClick);
        const Icon = p.Icon;
        return (
          <button
            key={p.key}
            type="button"
            disabled={!isClickable}
            onClick={isClickable ? () => onStepClick!(i) : undefined}
            aria-current={isActive ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors",
              isActive
                ? "bg-blue-600 text-white font-medium"
                : isPast
                  ? "bg-green-100 text-green-700 hover:bg-green-200"
                  : "bg-gray-100 text-gray-400",
              isClickable ? "cursor-pointer" : "cursor-default"
            )}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
