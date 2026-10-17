"use client";

import { useState } from "react";
import { photoGpsFailureMessage, readPhotoGps } from "@/lib/exif";
import type { LatLng } from "@/lib/coords";

/**
 * 「写真の位置を使う」ボタン。押すと写真を選ばせ、撮影地(Exifの GPS)が読めたら
 * `onLocated`に渡す。**写真は添付しない**(位置を読むためだけに選ぶ)。
 *
 * 座標を指す画面(行った場所・位置の報告/修正・スポットの追加・追加の依頼)で共用する。
 * 渡した先は**すぐ保存せず、ピンを動かすだけ**にする —— 写真の位置は数十mずれることが
 * あるので、地図で確かめてから決めてもらう。読めなかったときは理由を短く出す
 * (iPhoneのSafariは写真を渡すときに位置情報を消すことがあるので、その手がかりも)。
 */
export default function PhotoLocationButton({
  onLocated,
  label = "写真の位置を使う",
  className = "",
}: {
  onLocated: (pos: LatLng) => void;
  label?: string;
  className?: string;
}) {
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setReading(true);
    setNote(null);
    const result = await readPhotoGps(file);
    setReading(false);
    if (!result.ok) {
      setNote(photoGpsFailureMessage(result.reason));
      return;
    }
    onLocated({ lat: result.lat, lng: result.lng });
  };

  return (
    <div className={className}>
      <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700">
        <span aria-hidden="true">📷</span>
        {reading ? "読み込み中…" : label}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={reading}
          onChange={handleChange}
        />
      </label>
      {note && <p className="mt-1 text-xs text-amber-700">{note}</p>}
    </div>
  );
}
