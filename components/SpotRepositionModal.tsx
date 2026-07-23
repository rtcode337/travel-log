"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { osmStyle } from "@/lib/mapStyle";
import { api } from "@/lib/api-client";
import type { Spot } from "@/lib/types";

/**
 * 非公開スポットの位置(緯度経度)を、ドラッグできるマーカーで修正するモーダル。
 * スポット詳細の「位置を修正」から開く。地図をドラッグして中央のピンを動かし、
 * 保存でPATCHする(座標以外は既存の値をそのまま送って消えないようにする)。
 */
export default function SpotRepositionModal({
  spot,
  onClose,
  onSaved,
}: {
  spot: Spot;
  onClose: () => void;
  onSaved: (updated: Spot) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [pos, setPos] = useState({ lat: spot.lat, lng: spot.lng });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: osmStyle,
      center: [spot.lng, spot.lat],
      zoom: 15,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const marker = new maplibregl.Marker({ color: "#dc2626", draggable: true })
      .setLngLat([spot.lng, spot.lat])
      .addTo(map);
    marker.on("dragend", () => {
      const { lat, lng } = marker.getLngLat();
      setPos({ lat, lng });
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // 初期スポットが変わる想定はないので、マウント時に一度だけ作る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    // 座標以外は既存値をそのまま送る(PATCHはこれらを無条件に上書きするため、
    // 送らないとnullで消えてしまう。categories/key/originは省略時は保持される)
    const { data, error } = await api.spots.update(spot.id, {
      name: spot.name,
      name_kana: spot.name_kana,
      lat: pos.lat,
      lng: pos.lng,
      region: spot.region,
      series: spot.series,
      description: spot.description,
    });
    setSaving(false);
    if (error || !data) {
      setError("保存に失敗しました: " + (error?.message ?? "unknown error"));
      return;
    }
    onSaved(data);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">位置を修正</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="text-xl leading-none text-gray-400"
          >
            ✕
          </button>
        </div>
        <p className="text-xs text-gray-500">
          赤いピンをドラッグして正しい位置に合わせてください。
        </p>
        <div
          ref={containerRef}
          className="h-72 w-full overflow-hidden rounded-lg border border-gray-200"
        />
        <p className="text-xs text-gray-500">
          緯度 {pos.lat.toFixed(5)} ・ 経度 {pos.lng.toFixed(5)}
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "保存中…" : "この位置で保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
