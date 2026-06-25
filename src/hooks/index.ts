/**
 * Barrel re-export for the three custom hooks added by the
 * system-improvements change. Consumers can import from `@/hooks`
 * instead of remembering the exact filename.
 */
export { useOptimizationFlow } from "./useOptimizationFlow";
export type { OptimizationFlow, OptimizePhase } from "./useOptimizationFlow";

export { useRouteEditor } from "./useRouteEditor";
export type { RouteEditorFlow, SelectedPOI } from "./useRouteEditor";

export { useHomePlacement } from "./useHomePlacement";
export type { HomePlacementFlow, PlacementMode } from "./useHomePlacement";
