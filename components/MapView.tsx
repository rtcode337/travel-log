"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createClient } from "@/lib/supabase/client";
import { osmStyle, JAPAN_CENTER, JAPAN_ZOOM } from "@/lib/mapStyle";
import type { Rank, Spot } from "@/lib/types";
import FilterBar, {
  DEFAULT_FILTERS,
  passesFilters,
  type SpotFilters,
} from "@/components/FilterBar";
import RankBadge from "@/components/RankBadge";

/** ランク別のピンの見た目: S=大きい金、A=銀、B=小さい灰 */
const pinStyles: Record<Rank, { size: number; bg: string; border: string }> = {
  S: { size: 26, bg: "#f59e0b", border: "#b45309" },
  A: { size: 20, bg: "#9ca3af", border: "#4b5563" },
  B: { size: 14, bg: "#d1d5db", border: "#9ca3af" },
};

function createPinElement(spot: Spot, visited: boolean): HTMLDivElement {
  const { size, bg, border } = pinStyles[spot.rank];
  const el = document.createElement("div");
  el.style.cssText = `
    width: ${size}px; height: ${size}px;
    background: ${bg}; border: 2px solid ${border};
    border-radius: 50%; cursor: pointer; position: relative;
    box-shadow: 0 1px 3px rgba(0,0,0,0.4);
  `;
  if (visited) {
    const check = document.createElement("div");
    check.textContent = "✓";
    check.style.cssText = `
      position: absolute; top: -7px; right: -7px;
      width: 15px; height: 15px; border-radius: 50%;
      background: #16a34a; color: white;
      font-size: 10px; line-height: 15px; text-align: center;
      font-weight: bold; border: 1.5px solid white;
    `;
    el.appendChild(check);
  }
  return el;
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  const [spots, setSpots] = useState<Spot[]>([]);
  const [visitedIds, setVisitedIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<SpotFilters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<Spot | null>(null);
  const [loading, setLoading] = useState(true);

  // 地図の初期化
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: osmStyle,
      center: JAPAN_CENTER,
      zoom: JAPAN_ZOOM,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(
      new maplibregl.GeolocateControl({ trackUserLocation: true }),
      "top-right"
    );
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // データ取得
  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const [{ data: spotsData }, { data: visitsData }] = await Promise.all([
        supabase
          .from("spots")
          .select("*")
          .eq("status", "published")
          .order("name"),
        supabase.from("visits").select("spot_id"),
      ]);
      setSpots((spotsData as Spot[]) ?? []);
      setVisitedIds(
        new Set((visitsData ?? []).map((v: { spot_id: string }) => v.spot_id))
      );
      setLoading(false);
    })();
  }, []);

  // マーカーの生成・フィルタ反映
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // 既存マーカーを一旦すべて破棄して作り直す(件数が少ないため単純に)
    markersRef.current.forEach((m) => m.remove());
    markersRef.current.clear();

    for (const spot of spots) {
      const visited = visitedIds.has(spot.id);
      if (!passesFilters(filters, spot.rank, spot.category, visited)) continue;

      const el = createPinElement(spot, visited);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelected(spot);
      });
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([spot.lng, spot.lat])
        .addTo(map);
      markersRef.current.set(spot.id, marker);
    }
  }, [spots, visitedIds, filters]);

  return (
    <div className="relative h-[calc(100dvh-4rem)]">
      <div ref={containerRef} className="h-full w-full" />

      {/* フィルタバー */}
      <div className="absolute inset-x-0 top-0 z-10 p-2">
        <div className="rounded-xl bg-white/95 p-2 shadow">
          <FilterBar filters={filters} onChange={setFilters} />
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60">
          <p className="text-sm text-gray-600">読み込み中…</p>
        </div>
      )}

      {/* ボトムシート: スポット概要 */}
      {selected && (
        <div className="absolute inset-x-0 bottom-0 z-20 rounded-t-2xl border-t border-gray-200 bg-white p-4 shadow-[0_-4px_16px_rgba(0,0,0,0.15)]">
          <div className="mx-auto max-w-lg">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <RankBadge rank={selected.rank} />
                <div>
                  <h2 className="font-bold leading-tight">{selected.name}</h2>
                  <p className="text-xs text-gray-500">
                    {selected.prefecture}
                    {selected.municipality && ` ${selected.municipality}`} ・{" "}
                    {selected.category}
                    {visitedIds.has(selected.id) && (
                      <span className="ml-1 font-medium text-green-600">
                        ✓ 訪問済み
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="rounded-full px-2 text-xl leading-none text-gray-400"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>
            {selected.description && (
              <p className="mb-3 line-clamp-2 text-sm text-gray-600">
                {selected.description}
              </p>
            )}
            <Link
              href={`/spots/${selected.id}`}
              className="block w-full rounded-lg bg-blue-600 py-2 text-center text-sm font-medium text-white"
            >
              詳細を見る
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
