'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Location } from '@/types';

interface LocationMapEditorProps {
  locations: Location[];
  onChange: (index: number, lat: number, lng: number) => void;
  height?: string;
}

export default function LocationMapEditor({
  locations,
  onChange,
  height = '100%',
}: LocationMapEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<number, L.Marker>>(new Map());

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: locations[0] ? [locations[0].lat, locations[0].lng] : [-15.5, -47.5],
      zoom: 13,
      attributionControl: false,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    L.control.attribution({ prefix: false }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync locations → draggable markers + fitBounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;

    // Remove old markers
    for (const [, m] of markers) m.remove();
    markers.clear();

    const bounds = L.latLngBounds([]);
    locations.forEach((loc, i) => {
      if (loc.lat === undefined || loc.lng === undefined) return;
      const marker = L.marker([loc.lat, loc.lng], { draggable: true })
        .addTo(map)
        .bindPopup(`<strong>${loc.name}</strong>`)
        .on('dragend', () => {
          const pos = marker.getLatLng();
          onChange(i, pos.lat, pos.lng);
        });
      markers.set(i, marker);
      bounds.extend([loc.lat, loc.lng]);
    });

    if (locations.length > 0 && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
    }
  }, [locations, onChange]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
