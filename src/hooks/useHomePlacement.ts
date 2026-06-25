"use client";

import { useCallback, useState } from "react";
import type { Config } from "@/types";

export type PlacementMode = "home" | null;

interface UseHomePlacementParams {
  /** Current config — the hook writes homeLat/homeLng through setConfig. */
  config: Config;
  setConfig: React.Dispatch<React.SetStateAction<Config>>;
}

export interface HomePlacementFlow {
  /** Active placement mode — `null` when not placing, `"home"` while placing. */
  placementMode: PlacementMode;
  /** Whether the map should allow click-to-place right now. */
  placingHome: boolean;
  /** Programmatic setter — rarely needed externally. */
  setPlacementMode: (mode: PlacementMode) => void;
  /** Drop a new home pin at (lat, lng) and exit placement mode. */
  handlePlaceHome: (lat: number, lng: number) => void;
  /** Toggle placement mode on/off (called by the ConfigPanel button). */
  handleTogglePlaceHome: () => void;
  /** Update home while the user drags the existing pin. */
  handleDragHome: (lat: number, lng: number) => void;
}

export function useHomePlacement({
  config: _config,
  setConfig,
}: UseHomePlacementParams): HomePlacementFlow {
  const [placementMode, setPlacementMode] = useState<PlacementMode>(null);

  const handlePlaceHome = useCallback(
    (lat: number, lng: number) => {
      setConfig((prev) => ({ ...prev, homeLat: lat, homeLng: lng }));
      setPlacementMode(null);
    },
    [setConfig],
  );

  const handleTogglePlaceHome = useCallback(() => {
    setPlacementMode((prev) => (prev === "home" ? null : "home"));
  }, []);

  const handleDragHome = useCallback(
    (lat: number, lng: number) => {
      setConfig((prev) => ({ ...prev, homeLat: lat, homeLng: lng }));
    },
    [setConfig],
  );

  return {
    placementMode,
    placingHome: placementMode === "home",
    setPlacementMode,
    handlePlaceHome,
    handleTogglePlaceHome,
    handleDragHome,
  };
}
