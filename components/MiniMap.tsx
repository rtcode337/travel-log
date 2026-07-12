"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { osmStyle } from "@/lib/mapStyle";
import type { Rank } from "@/lib/types";
import { getRankPinColor } from "@/lib/rankStyle";

export default function MiniMap({
  lat,
  lng,
  rank,
}: {
  lat: number;
  lng: number;
  rank: Rank | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

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
    mapRef.current = map;
    new maplibregl.Marker({ color: getRankPinColor(rank) }).setLngLat([lng, lat]).addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng, rank]);

  return (
    <div
      ref={containerRef}
      className="h-40 w-full overflow-hidden rounded-lg border border-gray-200"
    />
  );
}
