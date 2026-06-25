'use client';

import { Radio, MapPin } from 'lucide-react';
import { isOptimizeMeta, type OptimizeResponse } from '@/types';
import { useTranslation } from 'react-i18next';

interface RoutingModeBadgeProps {
  /**
   * The full `_meta` block from the optimize response. When present
   * and passes `isOptimizeMeta()`, the badge surfaces routingMode,
   * unreachableCount and the per-source pair counts.
   */
  meta: OptimizeResponse['_meta'] | unknown;
}

const MODE_COLOR: Record<string, string> = {
  geoapify: 'bg-emerald-100 text-emerald-700',
  osrm: 'bg-blue-100 text-blue-700',
  api: 'bg-amber-100 text-amber-700',
  haversine: 'bg-gray-100 text-gray-600',
};

/**
 * Compact pill displayed near the ResultsPanel header that shows the
 * routing mode + aggregate counts from the optimize response. Hidden
 * when the meta block is missing or doesn't pass `isOptimizeMeta()`
 * (legacy clients that pre-date PR 6).
 */
export default function RoutingModeBadge({ meta }: RoutingModeBadgeProps) {
  const { t } = useTranslation();
  if (!isOptimizeMeta(meta)) return null;

  const { routingMode, unreachableCount, realCount, estimatedCount } = meta;
  const modeKey = routingMode as keyof typeof MODE_COLOR;
  const colorClass = MODE_COLOR[modeKey] ?? MODE_COLOR.haversine;
  const modeLabel = t(`resultsPanel.routingModes.${routingMode}`, {
    defaultValue: routingMode.toUpperCase(),
  });

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="routing-mode-badge">
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${colorClass}`}
        title={t('resultsPanel.routingModeTitle', { mode: modeLabel })}
      >
        <Radio className="w-3 h-3" aria-hidden="true" />
        {modeLabel}
      </span>
      {typeof unreachableCount === 'number' && unreachableCount > 0 && (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700"
          title={t('resultsPanel.unreachableCountTitle', { count: unreachableCount })}
        >
          <MapPin className="w-3 h-3" aria-hidden="true" />
          {t('resultsPanel.unreachableCountLabel', { count: unreachableCount })}
        </span>
      )}
      {typeof realCount === 'number' &&
        typeof estimatedCount === 'number' &&
        realCount + estimatedCount > 0 && (
          <span className="text-[10px] font-normal text-gray-400">
            {t('resultsPanel.routingSourceBreakdown', {
              real: realCount,
              estimated: estimatedCount,
            })}
          </span>
        )}
    </div>
  );
}
