import L from "leaflet";

/** Home marker (SVG house) */
export function createHomeIcon(draggable: boolean): L.DivIcon {
  return L.divIcon({
    html: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#2563eb" fill-opacity="0.7" stroke="white" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    className: "", // Leaflet adds its own classes; empty string prevents default icon styling
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

/** Numbered route stop marker */
export function createRouteStopIcon(sequence: number, color: string): L.DivIcon {
  return L.divIcon({
    html: `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${color};color:white;font-size:12px;font-weight:700;box-shadow:0 2px 4px rgba(0,0,0,0.3);border:2px solid white;cursor:pointer;">${sequence}</div>`,
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** Location pin dot — blue (#3b82f6) for assigned, red (#ef4444) for unassigned */
export function createPinIcon(assigned: boolean = true): L.DivIcon {
  const color = assigned ? "#3b82f6" : "#ef4444";
  return L.divIcon({
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>`,
    className: "",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}
