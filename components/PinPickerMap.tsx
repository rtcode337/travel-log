"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "@/lib/maplibre";
import { osmStyle } from "@/lib/mapStyle";
import { api } from "@/lib/api-client";
import { distanceMeters, formatDistance, type LatLng } from "@/lib/coords";
import type { NearbySpot } from "@/lib/types";
import PhotoLocationButton from "@/components/PhotoLocationButton";

// 開いたときの拡大率(建物が見分けられる大きさ)
const OPEN_ZOOM = 18;
/** ピンを近くのスポットに吸い付ける距離(画面上のpx)。指先でおおむね重ねたと言える幅 */
const SNAP_PX = 15;
/** 近くのスポットを引く半径(m)。開いたときの拡大率で画面の外まで少し届く広さ */
const NEARBY_RADIUS_M = 400;
/** 地図の中心がこれだけ動いたら近くのスポットを引き直す(m)。半径の半分ほど */
const NEARBY_REFETCH_M = 200;
/** これより引いた拡大率では近くのスポットを引かない(点が意味を持たない広さ) */
const NEARBY_MIN_ZOOM = 14;
/** 地図の下に並べる近くのスポットの件数 */
const NEARBY_LIST_COUNT = 5;

const NEARBY_SOURCE_ID = "nearby-spots";
const NEARBY_LAYER_ID = "nearby-spots-dot";

/**
 * ドラッグできるマーカーで座標を指す地図(座標を指す画面の共通部品)。
 *
 * 使うところ: スポットの「位置を報告」「位置を修正」(`SpotRepositionModal`)、
 * 訪問記録の「行った場所」、スポットの追加・追加の依頼で写真の位置を確かめるとき
 * (どれも`PickLocationModal`経由)。
 *
 * - **建物が見分けられる拡大率で開く**(`OPEN_ZOOM`)。直したいのは数十mのずれなので
 * - **現在地を青丸で出す**(現地で見ながら指すことが多い。地図は動かさず、寄るのはボタンで)
 * - **近くのスポットを小さな点で出す**(種別をまたいで、見られる全種別。`/api/spots/nearby`)。
 *   同じ建物に入っている店はピンを重ねたいので、ピンを点の近く(`SNAP_PX`以内)で離すと
 *   **その座標にぴったり吸い付く**。吸着はトグルで切れる。地図の下には近い順に数件並べ、
 *   押すとその座標に合わせる
 * - **「写真の位置を使う」**でピンを撮影地へ動かす(保存はしない。地図で確かめてから決める)
 *
 * 座標は親が持つ(`value`/`onChange`)。マーカーは`value`に追従する。
 */
export default function PinPickerMap({
  value,
  onChange,
  excludeSpotId,
  heightClassName = "h-64",
}: {
  value: LatLng;
  onChange: (pos: LatLng) => void;
  /** 近くのスポットから除くスポット(位置を直している当のスポット) */
  excludeSpotId?: string;
  heightClassName?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);
  // 現在地(取れたときだけ)
  const [here, setHere] = useState<LatLng | null>(null);
  const [nearby, setNearby] = useState<NearbySpot[]>([]);
  const [snapEnabled, setSnapEnabled] = useState(true);
  // ドラッグ中に、離せば吸い付く先(画面に「離すと…」を出すため)
  const [snapCandidate, setSnapCandidate] = useState<NearbySpot | null>(null);
  const [nearbyError, setNearbyError] = useState(false);

  // 地図のイベントはマウント時に一度だけ束縛するので、変わる値はrefで読む
  const nearbyRef = useRef<NearbySpot[]>([]);
  nearbyRef.current = nearby;
  const snapEnabledRef = useRef(snapEnabled);
  snapEnabledRef.current = snapEnabled;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastFetchRef = useRef<LatLng | null>(null);

  /** マーカーの画面位置からSNAP_PX以内でいちばん近いスポット(吸着が切れていればnull) */
  const findSnapTarget = (map: maplibregl.Map, at: maplibregl.LngLat): NearbySpot | null => {
    if (!snapEnabledRef.current) return null;
    const p = map.project(at);
    let best: NearbySpot | null = null;
    let bestPx = SNAP_PX;
    for (const spot of nearbyRef.current) {
      const q = map.project([spot.lng, spot.lat]);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d <= bestPx) {
        best = spot;
        bestPx = d;
      }
    }
    return best;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: 地図はマウント時に一度だけ作る(座標の変化は下の追従で反映する)
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: osmStyle,
      center: [value.lng, value.lat],
      // **建物が見分けられるところまで寄せて開く。** 直したいのは微妙なずれ(数十m)なので、
      // 町内が見渡せる程度(15)だと、ピンを動かす前に毎回拡大し直すことになった
      zoom: OPEN_ZOOM,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const marker = new maplibregl.Marker({ color: "#dc2626", draggable: true })
      .setLngLat([value.lng, value.lat])
      .addTo(map);
    markerRef.current = marker;
    marker.on("drag", () => {
      const target = findSnapTarget(map, marker.getLngLat());
      setSnapCandidate((prev) => (prev?.id === target?.id ? prev : target));
    });
    marker.on("dragend", () => {
      setSnapCandidate(null);
      const target = findSnapTarget(map, marker.getLngLat());
      if (target) {
        // **座標をそのスポットのものにそろえる**(画面上で重なって見えるだけでは、
        // 小数の末尾がずれて「同じ地点」として重ならない)
        marker.setLngLat([target.lng, target.lat]);
        onChangeRef.current({ lat: target.lat, lng: target.lng });
        return;
      }
      const { lat, lng } = marker.getLngLat();
      onChangeRef.current({ lat, lng });
    });
    // **`load`ではなく最初の`styledata`で点のレイヤーを足す**(MapViewと同じ理由。
    // `load`はタイルが読めない環境では発火しないことがあり、そうなると点も吸着も出ない)
    let layersAdded = false;
    map.on("styledata", () => {
      if (layersAdded) return;
      layersAdded = true;
      // 近くのスポットの点。ピン(DOMのマーカー)より下に描かれるので、ピンを隠さない
      map.addSource(NEARBY_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: NEARBY_LAYER_ID,
        type: "circle",
        source: NEARBY_SOURCE_ID,
        paint: {
          "circle-radius": 5,
          "circle-color": "#4b5563",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });
      setMapReady(true);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // 親の座標(写真の位置・一覧から選んだスポット・リセット)にマーカーを合わせる
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const at = marker.getLngLat();
    if (at.lat !== value.lat || at.lng !== value.lng) {
      marker.setLngLat([value.lng, value.lat]);
    }
  }, [value.lat, value.lng]);

  // **近くのスポットは地図の中心の周りを引き、中心が大きく動いたら引き直す**
  // (ピンを遠くへ動かしたとき・写真の位置へ飛んだときも、その周りの点が出るように)。
  // 地図を動かすたびに引くと重いので、前回の中心からNEARBY_REFETCH_M以上離れたときだけ
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let cancelled = false;
    const refetch = () => {
      if (map.getZoom() < NEARBY_MIN_ZOOM) return;
      const c = map.getCenter();
      const center = { lat: c.lat, lng: c.lng };
      const last = lastFetchRef.current;
      if (last && distanceMeters(last, center) < NEARBY_REFETCH_M) return;
      lastFetchRef.current = center;
      api.spots
        .nearby(center.lat, center.lng, { exclude: excludeSpotId, radius: NEARBY_RADIUS_M })
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error || !data) {
            // 引けなかった中心は覚えておかない(次に動かしたとき引き直せるように)
            lastFetchRef.current = null;
            setNearbyError(true);
            return;
          }
          setNearbyError(false);
          setNearby(data);
        });
    };
    refetch();
    map.on("moveend", refetch);
    return () => {
      cancelled = true;
      map.off("moveend", refetch);
    };
  }, [mapReady, excludeSpotId]);

  // 点の描画
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource(NEARBY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: nearby.map((s) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        properties: { id: s.id },
      })),
    });
  }, [nearby, mapReady]);

  // **現在地の青丸**(地図アプリの現在地と同じ見た目。MapLibre の`maplibregl-user-location-dot`)。
  // 地図は動かさない —— 開いたときは指す場所に寄っていてほしい(現在地へは下のボタンで寄る)。
  // 取れない・断られたときは何も出さない(位置を指す操作そのものは要らない)
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let marker: maplibregl.Marker | null = null;
    const watch = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const map = mapRef.current;
        if (!map) return;
        const at: [number, number] = [coords.longitude, coords.latitude];
        if (!marker) {
          const dot = document.createElement("div");
          dot.className = "maplibregl-user-location-dot";
          marker = new maplibregl.Marker({ element: dot }).setLngLat(at).addTo(map);
        } else {
          marker.setLngLat(at);
        }
        setHere({ lat: coords.latitude, lng: coords.longitude });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10_000 }
    );
    return () => {
      navigator.geolocation.clearWatch(watch);
      marker?.remove();
    };
  }, []);

  /** ピンを動かし、そこへ地図を寄せる(写真の位置・一覧から選んだスポット) */
  const moveTo = (pos: LatLng) => {
    onChange(pos);
    mapRef.current?.easeTo({ center: [pos.lng, pos.lat] });
  };

  // いまピンがぴったり重なっているスポット(吸い付いた先・一覧から選んだ先)
  const sameAs = useMemo(
    () => nearby.filter((s) => s.lat === value.lat && s.lng === value.lng),
    [nearby, value.lat, value.lng]
  );
  // 一覧はピンからの距離で並べる(引いたのは地図の中心の周りなので、並べ直す)
  const nearbyList = useMemo(
    () =>
      nearby
        .map((spot) => ({ spot, d: distanceMeters(value, spot) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, NEARBY_LIST_COUNT),
    [nearby, value]
  );

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className={`${heightClassName} w-full overflow-hidden rounded-lg border border-gray-200`}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-gray-500">
        <span>
          緯度 {value.lat.toFixed(5)} ・ 経度 {value.lng.toFixed(5)}
        </span>
        {/* 青丸(現在地)へ寄る。ピンは動かさない(ずれを見比べたいことがあるため) */}
        {here && (
          <button
            type="button"
            onClick={() => mapRef.current?.easeTo({ center: [here.lng, here.lat] })}
            className="shrink-0 text-blue-600 underline"
          >
            現在地へ寄る
          </button>
        )}
      </div>
      {(snapCandidate || sameAs.length > 0) && (
        <p className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-800">
          {snapCandidate
            ? `離すと「${snapCandidate.name}」の位置に合わせます`
            : `「${sameAs.map((s) => s.name).join("」「")}」と同じ位置`}
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PhotoLocationButton onLocated={moveTo} />
        <label className="flex items-center gap-1.5 py-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => setSnapEnabled(e.target.checked)}
          />
          近くのスポットに吸い付ける
        </label>
      </div>
      {(nearbyList.length > 0 || nearbyError) && (
        <div>
          <p className="mb-1 text-xs font-medium text-gray-600">近くのスポット</p>
          {nearbyError && (
            <p className="text-xs text-gray-400">近くのスポットを読み込めませんでした。</p>
          )}
          {nearbyList.length > 0 && (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {nearbyList.map(({ spot, d }) => {
              const same = spot.lat === value.lat && spot.lng === value.lng;
              return (
                <li key={spot.id}>
                  <button
                    type="button"
                    onClick={() => moveTo({ lat: spot.lat, lng: spot.lng })}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-gray-50"
                  >
                    <span className="min-w-0 flex-1 truncate">{spot.name}</span>
                    <span className="shrink-0 text-xs text-gray-400">{spot.type_label}</span>
                    <span className="w-14 shrink-0 text-right text-xs text-gray-500">
                      {same ? "同じ位置" : formatDistance(d)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          )}
        </div>
      )}
    </div>
  );
}
