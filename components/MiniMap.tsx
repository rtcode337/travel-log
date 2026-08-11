"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "@/lib/maplibre";
import { osmStyle } from "@/lib/mapStyle";
import type { Series } from "@/lib/types";
import { type SeriesStyleDefinition } from "@/lib/seriesStyle";
import type { Rank } from "@/lib/rank";
import { resolveSpotFace } from "@/lib/spotStyle";

export default function MiniMap({
  lat,
  lng,
  rank,
  series,
  seriesStyles,
  rankEnabled = false,
}: {
  lat: number;
  lng: number;
  /** マーカーの色はランク由来(ランクを使わない種別ではシリーズ由来) */
  rank: Rank | null;
  series: Series | null;
  /** このスポットが属するスポット種別のシリーズ設定(lib/useSeriesStyles.ts参照) */
  seriesStyles: SeriesStyleDefinition[];
  rankEnabled?: boolean;
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
    const color = resolveSpotFace(rank, series, seriesStyles, rankEnabled).color;
    new maplibregl.Marker({ color }).setLngLat([lng, lat]).addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng, rank, series, seriesStyles, rankEnabled]);

  return (
    <div
      ref={containerRef}
      className="h-40 w-full overflow-hidden rounded-lg border border-gray-200"
    />
  );
}
