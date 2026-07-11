"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { osmStyle } from "@/lib/mapStyle";
import type { Rank } from "@/lib/types";

const pinColors: Record<Rank, string> = {
  S: "#f59e0b",
  A: "#9ca3af",
  B: "#d1d5db",
};

export default function MiniMap({
  lat,
  lng,
  rank,
}: {
  lat: number;
  lng: number;
  rank: Rank;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: osmStyle,
      center: [lng, lat],
      zoom: 12,
      interactive: false,
      attributionControl: { compact: true },
    });
    new maplibregl.Marker({ color: pinColors[rank] })
      .setLngLat([lng, lat])
      .addTo(map);
    return () => {
      map.remove();
    };
  }, [lat, lng, rank]);

  return (
    <div
      ref={containerRef}
      className="h-40 w-full overflow-hidden rounded-lg border border-gray-200"
    />
  );
}
