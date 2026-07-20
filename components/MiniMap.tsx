"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { osmStyle } from "@/lib/mapStyle";
import type { Rank } from "@/lib/types";
import { findRankStyle, type RankStyleDefinition } from "@/lib/rankStyle";

export default function MiniMap({
  lat,
  lng,
  rank,
  rankStyles,
}: {
  lat: number;
  lng: number;
  rank: Rank | null;
  /** このスポットが属するスポット種別のランク設定(lib/useRankStyles.ts参照) */
  rankStyles: RankStyleDefinition[];
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
    const color = findRankStyle(rank, rankStyles).color;
    new maplibregl.Marker({ color }).setLngLat([lng, lat]).addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng, rank, rankStyles]);

  return (
    <div
      ref={containerRef}
      className="h-40 w-full overflow-hidden rounded-lg border border-gray-200"
    />
  );
}
