"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { ensurePinImage, pinIconId, PIN_ICON_PAD } from "@/lib/pinIcon";
import { formatBytes, formatDownloadedAt, useSpotCache } from "@/lib/useSpotCache";
import FilterBar, {
  DEFAULT_FILTERS,
  passesFilters,
  type SpotFilters,
} from "@/components/FilterBar";
import AddSpotModal from "@/components/AddSpotModal";
import SpotDetailModal from "@/components/SpotDetailModal";
import SpotDownloadDialogs from "@/components/SpotDownloadDialogs";

const CLUSTER_SOURCE_ID = "spots-cluster";
const CLUSTER_LAYER_ID = "spots-clusters";
const CLUSTER_COUNT_LAYER_ID = "spots-cluster-count";
const UNCLUSTERED_LAYER_ID = "spots-unclustered-point";

type ClusterFeatureProps = {
  id: string;
  rank: string | null;
  visited: boolean;
  /** ensurePinImageで登録済みのピン画像ID */
  icon: string;
};

function buildClusterGeoJSON(
  spots: Spot[],
  visitedIds: Set<string>
): GeoJSON.FeatureCollection<GeoJSON.Point, ClusterFeatureProps> {
  return {
    type: "FeatureCollection",
    features: spots.map((spot) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [spot.lng, spot.lat] },
      properties: {
        id: spot.id,
        rank: spot.rank,
        visited: visitedIds.has(spot.id),
        icon: pinIconId(
          spot.rank,
          visitedIds.has(spot.id),
          spot.status === "private"
        ),
      },
    })),
  };
}

/** クラスタ用のsource/layerを(まだなければ)追加する。冪等 */
function ensureClusterLayers(
  map: maplibregl.Map,
  onSelectSpot: (id: string) => void
) {
  if (map.getSource(CLUSTER_SOURCE_ID)) return;

  map.addSource(CLUSTER_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterMaxZoom: 16,
    clusterRadius: 50,
  });

  map.addLayer({
    id: CLUSTER_LAYER_ID,
    type: "circle",
    source: CLUSTER_SOURCE_ID,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#2563eb",
      "circle-opacity": 0.85,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
      "circle-radius": [
        "step",
        ["get", "point_count"],
        14,
        50, 18,
        500, 24,
        2000, 30,
      ],
    },
  });

  map.addLayer({
    id: CLUSTER_COUNT_LAYER_ID,
    type: "symbol",
    source: CLUSTER_SOURCE_ID,
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });

  // 下がとんがった吹き出し型のピン画像(ランク文字・チェックマーク込みで
  // lib/pinIcon.tsが生成し、GeoJSON側のiconプロパティでIDを指定する)。
  // とんがりの先端がスポットの座標を指すようにicon-anchorはbottomにする
  map.addLayer({
    id: UNCLUSTERED_LAYER_ID,
    type: "symbol",
    source: CLUSTER_SOURCE_ID,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "icon-image": ["get", "icon"],
      "icon-anchor": "bottom",
      // 画像下端の影用余白の分だけ押し下げ、とんがりの先端を座標に一致させる
      "icon-offset": [0, PIN_ICON_PAD],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });

  map.on("click", CLUSTER_LAYER_ID, async (e) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: [CLUSTER_LAYER_ID],
    });
    const clusterId = features[0]?.properties?.cluster_id;
    if (clusterId == null) return;
    const source = map.getSource(CLUSTER_SOURCE_ID) as maplibregl.GeoJSONSource;
    const zoom = await source.getClusterExpansionZoom(clusterId);
    map.easeTo({
      center: (features[0].geometry as GeoJSON.Point).coordinates as [
        number,
        number,
      ],
      zoom,
    });
  });

  map.on("click", UNCLUSTERED_LAYER_ID, (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (id) onSelectSpot(id);
  });

  for (const layerId of [CLUSTER_LAYER_ID, UNCLUSTERED_LAYER_ID]) {
    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  }
}

function showClusterLayers(map: maplibregl.Map) {
  for (const id of [
    CLUSTER_LAYER_ID,
    CLUSTER_COUNT_LAYER_ID,
    UNCLUSTERED_LAYER_ID,
  ]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
  }
}

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
    pointer-events: none;
  `;
  return el;
}

export default function MapView({
  spotTypeKey,
}: {
  /** 表示対象のスポット種類キー(常に /[type]/map から渡される) */
  spotTypeKey: string;
}) {
  const searchParams = useSearchParams();
  const focusSpotId = searchParams.get("spot");

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  /**
   * スタイル(レイヤー追加等が可能な状態)になったかどうかと、それを待っている処理。
   * isStyleLoaded()はタイル読み込み中などスタイル適用後でもfalseを返すことがあり、
   * loadイベントはタイルが読めない環境では発火しないことがあるため、どちらにも
   * 依存せず「styledataが一度でも発火したか」で判定する(スタイルは同梱のJSONなので
   * styledataは必ず発火する)。準備完了前に来た描画処理はpendingに積んで発火時に流す
   */
  const mapReadyRef = useRef(false);
  const pendingMapReadyRef = useRef<(() => void)[]>([]);

  /** fnをスタイル準備完了後に(完了済みなら即座に)実行する */
  const runWhenMapReady = useCallback((fn: () => void) => {
    const map = mapRef.current;
    if (!map) return;
    if (mapReadyRef.current || map.isStyleLoaded()) {
      mapReadyRef.current = true;
      fn();
    } else {
      pendingMapReadyRef.current.push(fn);
    }
  }, []);
  const locationDotRef = useRef<maplibregl.Marker | null>(null);

  const spotCache = useSpotCache(spotTypeKey);
  const [privateSpots, setPrivateSpots] = useState<Spot[]>([]);
  const spots = useMemo(
    () => [...(spotCache.publicSpots ?? []), ...privateSpots],
    [spotCache.publicSpots, privateSpots]
  );
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
    { id: string; lat: number; lng: number; name: string; status: string }[]
  >([]);
  const pendingMarkersRef = useRef<maplibregl.Marker[]>([]);

  const [showFilterModal, setShowFilterModal] = useState(false);
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
    mapReadyRef.current = false;
    pendingMapReadyRef.current = [];
    map.on("styledata", () => {
      if (mapReadyRef.current) return;
      mapReadyRef.current = true;
      const pending = pendingMapReadyRef.current;
      pendingMapReadyRef.current = [];
      for (const fn of pending) fn();
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

    // 右クリック(PC)でスポット追加メニューを出す(ログイン中なら誰でも、非公開スポットとして
    // 追加できる)。roleがまだ分からない間は通常のブラウザメニューのままにする
    const handleContextMenu = (e: maplibregl.MapMouseEvent) => {
      if (!roleRef.current) return;
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
      if (!roleRef.current) return;
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

  // 公開スポットはIndexedDBの明示ダウンロードキャッシュ(spotCache)から得るため、
  // ここでは自分の非公開スポットだけをAPIから取り直す
  const loadPrivateSpots = useCallback(async () => {
    const { data } = await api.spots.list("private", { type: spotTypeKey });
    setPrivateSpots(data ?? []);
  }, [spotTypeKey]);

  // データ取得
  useEffect(() => {
    (async () => {
      await Promise.all([loadPrivateSpots(), loadVisits()]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotTypeKey]);

  // /map?spot=<id> で開かれたら、そのスポットの位置にズームする
  // (詳細モーダルは開かない: モーダルがピンの真上に重なりどこが開かれたか分からなくなるため)
  // (一覧画面の「アプリの地図で開く」から遷移してきたときなど)
  useEffect(() => {
    if (!focusSpotId || spots.length === 0) return;
    const map = mapRef.current;
    if (!map) return;
    const target = spots.find((s) => s.id === focusSpotId);
    if (!target) return;

    const fly = () => {
      map.flyTo({ center: [target.lng, target.lat], zoom: 16 });
    };
    runWhenMapReady(fly);

    // 一度処理したらURLから消す(戻る操作やスポット再取得のたびに再発火しないように)。
    // next/navigationのrouter.replaceだとuseSearchParams経由でSuspense境界が
    // 再評価され、MapView自体が再マウントされてspotsが空に戻ってしまうことが
    // あったため、ブラウザ標準のHistory APIで直接URLだけ書き換える
    window.history.replaceState(null, "", `/${spotTypeKey}/map`);
  }, [focusSpotId, spots, spotTypeKey, runWhenMapReady]);

  // マーカーの生成・フィルタ反映。
  // 公開スポットも自分の非公開スポットも同じWebGLクラスタ表示で描画する
  // (非公開はピン画像を破線縁取りにして見分ける)。
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const filteredSpots = spots.filter((spot) =>
      passesFilters(filters, spot.rank, visitedIds.has(spot.id))
    );

    const renderSpots = () => {
      ensureClusterLayers(map, setDetailSpotId);
      showClusterLayers(map);
      // 使われるピン画像(ランク×訪問済み×非公開)を先に登録してからデータを流し込む
      for (const spot of filteredSpots) {
        ensurePinImage(
          map,
          spot.rank,
          visitedIds.has(spot.id),
          spot.status === "private"
        );
      }
      const source = map.getSource(CLUSTER_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      source?.setData(buildClusterGeoJSON(filteredSpots, visitedIds));
    };
    runWhenMapReady(renderSpots);
  }, [spots, visitedIds, filters, runWhenMapReady]);

  // 今回のセッションで送信した承認待ち/非公開スポットの仮ピン(破線)を表示
  // (通常の取得はpublishedのみなので、それ以外は一覧に反映されるまでこれで見せる)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    pendingMarkersRef.current.forEach((m) => m.remove());
    pendingMarkersRef.current = [];

    for (const p of pendingSpots) {
      const label = p.status === "private" ? "非公開" : "承認待ち";
      const color = p.status === "private" ? "#6b7280" : "#d97706";
      const el = document.createElement("div");
      el.title = `${p.name}(${label})`;
      el.style.cssText = `
        width: 16px; height: 16px; border-radius: 50%;
        background: ${color}4d; border: 2px dashed ${color};
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

      {/* 検索バー・絞り込みボタン(右上のズーム/現在地ボタンと重ならないよう右側を開ける) */}
      <div className="absolute left-0 right-14 top-0 z-10 space-y-2 p-2">
        <div className="rounded-xl bg-white/95 p-2 shadow">
          <div className="flex gap-2">
            <form onSubmit={handleSearch} className="flex min-w-0 flex-1 gap-2">
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
            <button
              type="button"
              onClick={() => setShowFilterModal(true)}
              aria-label="絞り込み"
              className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-lg leading-none"
            >
              ☰
            </button>
          </div>
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

      {/* 絞り込みモーダル */}
      {showFilterModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => setShowFilterModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold">絞り込み</h2>
              <button
                type="button"
                onClick={() => setShowFilterModal(false)}
                aria-label="閉じる"
                className="text-xl leading-none text-gray-400"
              >
                ✕
              </button>
            </div>
            <FilterBar spots={spots} filters={filters} onChange={setFilters} />

            <div className="border-t border-gray-100 pt-3">
              <p className="mb-1 text-sm font-medium">公開スポットのダウンロード</p>
              <p className="mb-2 text-xs text-gray-500">
                {spotCache.downloadedAt
                  ? `前回ダウンロード: ${formatDownloadedAt(spotCache.downloadedAt)}`
                  : "まだダウンロードしていません。"}
              </p>
              {spotCache.error && (
                <p className="mb-2 text-xs text-red-600">{spotCache.error}</p>
              )}
              <button
                type="button"
                onClick={spotCache.startManualDownload}
                disabled={spotCache.downloading}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {spotCache.downloading ? "確認中…" : "公開スポットをダウンロード"}
              </button>
            </div>
          </div>
        </div>
      )}

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
          spotTypeKey={spotTypeKey}
          spots={spots}
          role={role}
          onClose={() => setAddSpotAt(null)}
          onSaved={(spot) => {
            if (spot.status === "private") {
              // 非公開は自分にだけ常に見えるので、通常のスポットと同じように取り直して表示する
              loadPrivateSpots();
            } else {
              setPendingSpots((prev) => [
                ...prev,
                {
                  id: spot.id,
                  lat: spot.lat,
                  lng: spot.lng,
                  name: spot.name,
                  status: spot.status,
                },
              ]);
            }
            setAddSpotAt(null);
          }}
        />
      )}

      {/* スポット詳細モーダル */}
      {detailSpotId && (
        <SpotDetailModal
          spotId={detailSpotId}
          spots={spots}
          onClose={() => setDetailSpotId(null)}
          onVisitChange={loadVisits}
          onSpotChange={(spot) => {
            spotCache.applySpotChange(spot);
            loadPrivateSpots();
          }}
          onSpotDeleted={(id) => {
            spotCache.applySpotDelete(id);
            loadPrivateSpots();
          }}
        />
      )}

      <SpotDownloadDialogs cache={spotCache} />
    </div>
  );
}
