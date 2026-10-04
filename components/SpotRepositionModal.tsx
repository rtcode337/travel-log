"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "@/lib/maplibre";
import { osmStyle } from "@/lib/mapStyle";
import { api } from "@/lib/api-client";
import type { Spot } from "@/lib/types";
import Modal from "@/components/Modal";

// 開いたときの拡大率(建物が見分けられる大きさ)
const OPEN_ZOOM = 18;

/**
 * スポットの位置(緯度経度)を、ドラッグできるマーカーで指すモーダル。2 つの使い方がある。
 *
 * - **非公開スポットの位置を直す**(`onSaved`)。スポット詳細の「位置を修正」から開き、
 *   保存でPATCHする(座標以外は既存の値をそのまま送って消えないようにする)
 * - **公開スポットの位置を報告する**(`onPick`)。スポット詳細の「位置を報告」から
 *   開き、スポットそのものには触らずに、指した座標を呼び出し側へ渡す(依頼にする)。
 *   公開スポットは収集から取り込み直されるので、ここで直しても次の取り込みで戻る ——
 *   直すのは収集を回す側で、こちらは正しい位置を伝えるだけ
 */
export default function SpotRepositionModal({
  spot,
  onClose,
  onSaved,
  onPick,
}: {
  spot: Spot;
  onClose: () => void;
  onSaved?: (updated: Spot) => void;
  /** 指した座標を渡す。失敗したら理由を返す(モーダルに出す) */
  onPick?: (lat: number, lng: number) => Promise<string | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [pos, setPos] = useState({ lat: spot.lat, lng: spot.lng });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 初期スポットが変わる想定はないので、地図はマウント時に一度だけ作る
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: osmStyle,
      center: [spot.lng, spot.lat],
      // **建物が見分けられるところまで寄せて開く。** 直したいのは微妙なずれ(数十m)なので、
      // 町内が見渡せる程度(15)だと、ピンを動かす前に毎回拡大し直すことになった
      zoom: OPEN_ZOOM,
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
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    if (onPick) {
      const failed = await onPick(pos.lat, pos.lng);
      setSaving(false);
      if (failed) setError(failed);
      return;
    }
    // 座標以外は既存値をそのまま送る(PATCHはこれらを無条件に上書きするため、
    // 送らないとnullで消えてしまう。categories/key/originは省略時は保持される)
    const { data, error } = await api.spots.update(spot.id, {
      name: spot.name,
      name_kana: spot.name_kana,
      lat: pos.lat,
      lng: pos.lng,
      region: spot.region,
      rank: spot.rank,
      series: spot.series,
      description: spot.description,
    });
    setSaving(false);
    if (error || !data) {
      setError("保存に失敗しました: " + (error?.message ?? "unknown error"));
      return;
    }
    onSaved?.(data);
  };

  return (
    <Modal
      onClose={onClose}
      zIndexClassName="z-[60]"
      panelClassName="w-full max-w-md space-y-3 rounded-2xl bg-white p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">{onPick ? "位置を報告" : "位置を修正"}</h2>
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
        {onPick &&
          "いまの位置で合っていれば、動かさずにそのまま報告してください。スポットはすぐには動きません(収集を回す側が直したあと、取り込み直すと反映されます)。"}
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
          {saving
            ? onPick
              ? "依頼しています…"
              : "保存中…"
            : onPick
              ? "この位置で報告"
              : "この位置で保存"}
        </button>
      </div>
    </Modal>
  );
}
