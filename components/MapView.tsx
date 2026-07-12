"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api } from "@/lib/api-client";
import {
  osmStyle,
  JAPAN_CENTER,
  JAPAN_ZOOM,
  CURRENT_LOCATION_ZOOM,
} from "@/lib/mapStyle";
import type { Role, Spot } from "@/lib/types";
import { getRankPinStyle } from "@/lib/rankStyle";
import FilterBar, {
  DEFAULT_FILTERS,
  passesFilters,
  type SpotFilters,
} from "@/components/FilterBar";
import AddSpotModal from "@/components/AddSpotModal";
import SpotDetailModal from "@/components/SpotDetailModal";

const CAN_ADD_SPOT_ROLES: Role[] = ["admin", "moderator"];

/**
 * 直前に表示していた地図の中心・ズームを覚えておく(モジュールスコープの変数なので
 * 他画面へ遷移してMapViewがアンマウントされても、同じセッション内であれば保持される)。
 * これがあれば再訪時は現在地取得をせずそのまま復元し、なければ(このセッションで
 * 初めて/map を開いたとき)従来通り現在地取得を試みる。
 */
let lastView: { center: [number, number]; zoom: number } | null = null;

/**
 * 現在地の青い丸を表示していたかどうかも同様にモジュールスコープで記憶する。
 * 表示していた場合は最後に分かっている座標も覚えておき、再訪時に地図を動かさず
 * その場に仮の丸を復元する(新たな位置情報取得はしない)。
 */
let lastLocation: { lat: number; lng: number } | null = null;
let lastLocationVisible = false;

function createLocationDotElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width: 16px; height: 16px; border-radius: 50%;
    background: #2563eb; border: 3px solid white;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.25), 0 1px 4px rgba(0,0,0,0.4);
  `;
  return el;
}

function createPinElement(spot: Spot, visited: boolean): HTMLDivElement {
  const { size, bg, border } = getRankPinStyle(spot.rank);

  // MapLibreはこの要素自体に `.maplibregl-marker { position: absolute }` を
  // 適用して地図上に配置する。ここでinline styleに position を指定すると
  // (詳細度の関係で)それを上書きしてしまい、マーカーが通常のドキュメントフローに
  // 乗って本来と全く違う位置に積み上がってしまう。そのためピンの見た目(円+バッジ)は
  // 内側のラッパーに閉じ込め、外側要素にはpositionを指定しない。
  const outer = document.createElement("div");

  const inner = document.createElement("div");
  inner.style.cssText = `
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
    inner.appendChild(check);
  }
  outer.appendChild(inner);
  return outer;
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const locationDotRef = useRef<maplibregl.Marker | null>(null);

  const [spots, setSpots] = useState<Spot[]>([]);
  const [visitedIds, setVisitedIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<SpotFilters>(DEFAULT_FILTERS);
  const [detailSpotId, setDetailSpotId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [role, setRole] = useState<Role | null>(null);
  const roleRef = useRef<Role | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    lat: number;
    lng: number;
  } | null>(null);
  const [addSpotAt, setAddSpotAt] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [pendingSpots, setPendingSpots] = useState<
    { id: string; lat: number; lng: number; name: string }[]
  >([]);
  const pendingMarkersRef = useRef<maplibregl.Marker[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    { name: string; lat: number; lng: number }[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchMarkerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    api.auth.me().then(({ data }) => setRole(data?.role ?? null));
  }, []);

  // 地図の初期化
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: osmStyle,
      center: lastView?.center ?? JAPAN_CENTER,
      zoom: lastView?.zoom ?? JAPAN_ZOOM,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    const geolocate = new maplibregl.GeolocateControl({
      trackUserLocation: true,
      fitBoundsOptions: { maxZoom: CURRENT_LOCATION_ZOOM },
      positionOptions: { enableHighAccuracy: true, timeout: 10000 },
    });
    map.addControl(geolocate, "top-right");
    mapRef.current = map;

    // このセッションで初めて/mapを開いたときだけ、起動時に現在地を自動取得して
    // その周辺にズームインする(現在地を示す青い丸も表示される)。他画面から
    // 戻ってきたときは直前に表示していた位置・ズームをそのまま復元する
    if (!lastView) {
      map.on("load", () => geolocate.trigger());
    } else if (lastLocationVisible && lastLocation) {
      // 前回青い丸を表示していた場合、地図は動かさずその場に仮の丸だけ復元する
      // (新たな位置情報取得はしない。実際に取得できたら下のgeolocateイベントで
      // 本物の丸に置き換わる)
      locationDotRef.current = new maplibregl.Marker({
        element: createLocationDotElement(),
      })
        .setLngLat([lastLocation.lng, lastLocation.lat])
        .addTo(map);
    }

    // 現在地取得の成否・表示状態を覚えておき、次にこの画面を開いたときに復元する
    const handleGeolocate = (position: GeolocationPosition) => {
      lastLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      lastLocationVisible = true;
      // 実際の現在地マーカーが表示されるので、復元用の仮マーカーは片付ける
      locationDotRef.current?.remove();
      locationDotRef.current = null;
    };
    const handleGeolocateEnd = () => {
      lastLocationVisible = false;
    };
    geolocate.on("geolocate", handleGeolocate);
    geolocate.on("trackuserlocationend", handleGeolocateEnd);
    geolocate.on("error", handleGeolocateEnd);

    const saveView = () => {
      lastView = {
        center: map.getCenter().toArray() as [number, number],
        zoom: map.getZoom(),
      };
    };
    map.on("moveend", saveView);

    // トラックパッドの二本指スクロールは移動、Ctrl/⌘+スクロール(ピンチ)は拡大縮小にする。
    // MapLibreのデフォルトはどちらもズーム操作になってしまうため上書きする。
    map.scrollZoom.disable();
    const container = containerRef.current;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        map.setZoom(map.getZoom() - e.deltaY * 0.01);
      } else {
        map.panBy([e.deltaX, e.deltaY], { animate: false });
      }
    };
    container.addEventListener("wheel", handleWheel, { passive: false });

    // 右クリック(PC)でスポット追加メニューを出す。権限がない場合は通常のブラウザ
    // メニューのままにする(preventDefaultしない)
    const handleContextMenu = (e: maplibregl.MapMouseEvent) => {
      if (!CAN_ADD_SPOT_ROLES.includes(roleRef.current as Role)) return;
      e.originalEvent.preventDefault();
      setContextMenu({
        x: e.point.x,
        y: e.point.y,
        lat: e.lngLat.lat,
        lng: e.lngLat.lng,
      });
    };
    map.on("contextmenu", handleContextMenu);

    // 長押し(モバイル)でも同じメニューを出す
    let longPressTimer: number | null = null;
    let touchStart: { x: number; y: number } | null = null;
    const clearLongPress = () => {
      if (longPressTimer !== null) window.clearTimeout(longPressTimer);
      longPressTimer = null;
      touchStart = null;
    };
    const handleTouchStart = (e: TouchEvent) => {
      clearLongPress();
      if (e.touches.length !== 1) return;
      if (!CAN_ADD_SPOT_ROLES.includes(roleRef.current as Role)) return;
      const touch = e.touches[0];
      touchStart = { x: touch.clientX, y: touch.clientY };
      longPressTimer = window.setTimeout(() => {
        if (!touchStart) return;
        const rect = container.getBoundingClientRect();
        const point: [number, number] = [
          touchStart.x - rect.left,
          touchStart.y - rect.top,
        ];
        const lngLat = map.unproject(point);
        setContextMenu({
          x: point[0],
          y: point[1],
          lat: lngLat.lat,
          lng: lngLat.lng,
        });
        touchStart = null;
      }, 550);
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (!touchStart) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchStart.x;
      const dy = touch.clientY - touchStart.y;
      if (Math.hypot(dx, dy) > 10) clearLongPress();
    };
    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    container.addEventListener("touchend", clearLongPress);
    container.addEventListener("touchcancel", clearLongPress);

    return () => {
      saveView();
      container.removeEventListener("wheel", handleWheel);
      map.off("contextmenu", handleContextMenu);
      map.off("moveend", saveView);
      geolocate.off("geolocate", handleGeolocate);
      geolocate.off("trackuserlocationend", handleGeolocateEnd);
      geolocate.off("error", handleGeolocateEnd);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", clearLongPress);
      container.removeEventListener("touchcancel", clearLongPress);
      clearLongPress();
      locationDotRef.current?.remove();
      locationDotRef.current = null;
      searchMarkerRef.current?.remove();
      searchMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const loadVisits = async () => {
    const { data } = await api.visits.list();
    setVisitedIds(new Set((data ?? []).map((v) => v.spot_id)));
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    const { data, error } = await api.geocode.search(q);
    setSearching(false);
    if (error || !data) {
      setSearchError(error?.message ?? "検索に失敗しました");
      setSearchResults([]);
      return;
    }
    if (data.length === 0) {
      setSearchError("見つかりませんでした。");
    }
    setSearchResults(data);
  };

  const handleSelectSearchResult = (result: {
    name: string;
    lat: number;
    lng: number;
  }) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [result.lng, result.lat], zoom: 16 });

    searchMarkerRef.current?.remove();
    searchMarkerRef.current = new maplibregl.Marker({ color: "#dc2626" })
      .setLngLat([result.lng, result.lat])
      .setPopup(new maplibregl.Popup({ offset: 24 }).setText(result.name))
      .addTo(map)
      .togglePopup();

    setSearchResults([]);
  };

  // データ取得
  useEffect(() => {
    (async () => {
      const [{ data: spotsData }] = await Promise.all([
        api.spots.list("published"),
        loadVisits(),
      ]);
      setSpots(spotsData ?? []);
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
        setDetailSpotId(spot.id);
      });
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([spot.lng, spot.lat])
        .addTo(map);
      markersRef.current.set(spot.id, marker);
    }
  }, [spots, visitedIds, filters]);

  // 今回のセッションで送信した承認待ちスポットの仮ピン(破線)を表示
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    pendingMarkersRef.current.forEach((m) => m.remove());
    pendingMarkersRef.current = [];

    for (const p of pendingSpots) {
      const el = document.createElement("div");
      el.title = `${p.name}(承認待ち)`;
      el.style.cssText = `
        width: 16px; height: 16px; border-radius: 50%;
        background: rgba(217, 119, 6, 0.3); border: 2px dashed #d97706;
      `;
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([p.lng, p.lat])
        .addTo(map);
      pendingMarkersRef.current.push(marker);
    }
  }, [pendingSpots]);

  return (
    <div className="relative h-[calc(100dvh-4rem)]">
      <div ref={containerRef} className="h-full w-full" />

      {/* フィルタバー・検索バー(右上のズーム/現在地ボタンと重ならないよう右側を開ける) */}
      <div className="absolute left-0 right-16 top-0 z-10 space-y-2 p-2">
        <div className="rounded-xl bg-white/95 p-2 shadow">
          <FilterBar spots={spots} filters={filters} onChange={setFilters} />
        </div>
        <div className="rounded-xl bg-white/95 p-2 shadow">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="住所・建物名で検索"
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={searching}
              className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {searching ? "検索中…" : "検索"}
            </button>
          </form>
          {searchError && (
            <p className="mt-1.5 text-xs text-red-600">{searchError}</p>
          )}
          {searchResults.length > 0 && (
            <ul className="mt-1.5 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
              {searchResults.map((r, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => handleSelectSearchResult(r)}
                    className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    {r.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60">
          <p className="text-sm text-gray-600">読み込み中…</p>
        </div>
      )}

      {/* 右クリック/長押しメニュー */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            className="absolute z-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => {
                setAddSpotAt({ lat: contextMenu.lat, lng: contextMenu.lng });
                setContextMenu(null);
              }}
              className="whitespace-nowrap px-4 py-2 text-left text-sm hover:bg-gray-50"
            >
              ここにスポットを追加
            </button>
          </div>
        </>
      )}

      {/* スポット追加モーダル */}
      {addSpotAt && (
        <AddSpotModal
          lat={addSpotAt.lat}
          lng={addSpotAt.lng}
          spots={spots}
          onClose={() => setAddSpotAt(null)}
          onCreated={(spot) => {
            setPendingSpots((prev) => [
              ...prev,
              { id: spot.id, lat: spot.lat, lng: spot.lng, name: spot.name },
            ]);
            setAddSpotAt(null);
          }}
        />
      )}

      {/* スポット詳細モーダル */}
      {detailSpotId && (
        <SpotDetailModal
          spotId={detailSpotId}
          onClose={() => setDetailSpotId(null)}
          onVisitChange={loadVisits}
        />
      )}
    </div>
  );
}
