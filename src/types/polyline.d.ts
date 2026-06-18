// Type shim for @mapbox/polyline (the package ships JS only).
// The @types/polyline package declares the legacy "polyline" module,
// so we re-declare for the "@mapbox/polyline" import path used in this project.
declare module "@mapbox/polyline" {
  export function encode(coords: number[][], precision?: number): string;
  export function decode(str: string, precision?: number): number[][];
}
