"use client";

import { TriangleAlert, RotateCw, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { UnreachablePoi } from "@/types";
import { cn } from "@/lib/utils";

interface UnreachableWarningProps {
  unreachable: UnreachablePoi[];
  onRetry: () => void;
  /** Disables the retry button while an optimization is in flight. */
  loading?: boolean;
}

/**
 * Warning card surfaced when the API pre-filter excluded one or more POIs
 * because the routing provider had no real road connecting them to home.
 *
 * Distinct from `UnassignedPool` — unassigned POIs haven't been routed YET
 * (the user can drag them in). Unreachable POIs CANNOT be routed at all
 * (no road on the map), so we surface them with a "try again" CTA.
 */
export default function UnreachableWarning({
  unreachable,
  onRetry,
  loading,
}: UnreachableWarningProps) {
  const { t } = useTranslation();
  if (unreachable.length === 0) return null;

  return (
    <div className="card-base border-amber-300 bg-amber-50/60 overflow-hidden">
      <div className="card-header flex items-center justify-between bg-amber-100/60 border-amber-200 text-amber-800">
        <span className="flex items-center gap-2">
          <TriangleAlert className="w-4 h-4 text-amber-600" />
          {t("unreachableWarning.title")}
        </span>
        <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-amber-200 text-amber-800">
          {unreachable.length}
        </span>
      </div>

      <div className="card-body space-y-2">
        <p className="text-xs text-amber-700">
          {t("unreachableWarning.description")}
        </p>

        <ul className="divide-y divide-amber-200/70 -mx-1">
          {unreachable.map((poi, idx) => (
            <li
              key={`${poi.lat.toFixed(5)}-${poi.lng.toFixed(5)}-${idx}`}
              className="flex items-center gap-2 px-1 py-2 text-sm"
            >
              <MapPin className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span className="flex-1 min-w-0 truncate font-medium text-amber-900">
                {poi.name}
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-amber-100 text-amber-800 border-amber-200 shrink-0">
                {poi.lat.toFixed(4)}, {poi.lng.toFixed(4)}
              </span>
              <span
                title={poi.reason}
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-amber-200 text-amber-900 border-amber-300 shrink-0"
              >
                {humanizeReason(poi.reason, t)}
              </span>
            </li>
          ))}
        </ul>

        <button
          onClick={onRetry}
          disabled={loading}
          className="w-full text-sm py-2 rounded-md font-medium transition-colors inline-flex items-center justify-center gap-2 bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <RotateCw
            className={cn("w-3.5 h-3.5", loading && "animate-spin")}
          />
          {loading ? t("unreachableWarning.retrying") : t("unreachableWarning.retry")}
        </button>
      </div>
    </div>
  );
}

/** Map server-side reason codes to short, user-facing Spanish labels. */
function humanizeReason(reason: string, t: (key: string) => string): string {
  switch (reason) {
    case "no_road_connection":
      return t("unreachableWarning.noRoadConnection");
    default:
      return reason;
  }
}
