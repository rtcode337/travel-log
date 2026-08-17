"use client";

import { useState } from "react";
import { toDateTimeLocalValue } from "@/lib/visitPhoto";
import VisitPhotoFields from "@/components/VisitPhotoFields";

/**
 * 訪問記録の入力欄(訪問日時・写真・メモ)。訪問記録モーダル(VisitFormModal)と、
 * スポット追加時の「訪問を記録する」(AddSpotModal)で共用する。写真は「既存の相対パス」
 * または「追加写真のdata URL」の混在で親が保持し、この形のまま保存に渡す
 * (写真欄そのものは`VisitPhotoFields`。訪問記録への追記でも同じものを使う)。
 */
export default function VisitFields({
  visitedOn,
  onVisitedOnChange,
  memo,
  onMemoChange,
  photos,
  onPhotosChange,
  onProcessingChange,
  visitedOnHint,
}: {
  visitedOn: string;
  onVisitedOnChange: (value: string) => void;
  memo: string;
  onMemoChange: (value: string) => void;
  photos: string[];
  onPhotosChange: (photos: string[]) => void;
  /** 写真の縮小処理中を親へ伝える(送信ボタンのdisable用) */
  onProcessingChange?: (processing: boolean) => void;
  /** 訪問日時欄の下の説明文。未訪問記録では空にした意味が「時期不明」ではなく
   *  「下調べ」になるため、呼び出し側で差し替えられるようにしてある */
  visitedOnHint?: string;
}) {
  // 選択中の写真のExif撮影日時のうち最も古いもの(=その場所に着いた時刻)。
  // 訪問日時欄に入れるボタンを出すためだけに持つ(自動では入れない)
  const [earliestTakenAt, setEarliestTakenAt] = useState<Date | null>(null);
  const takenAtValue = earliestTakenAt
    ? toDateTimeLocalValue(earliestTakenAt)
    : null;

  return (
    <>
      <div>
        <label className="mb-1 block text-sm font-medium">訪問日時</label>
        <div className="flex gap-1.5">
          <input
            type="datetime-local"
            value={visitedOn}
            onChange={(e) => onVisitedOnChange(e.target.value)}
            className="w-full min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          {/* 「時期不明」「下調べ」用に空欄へ戻すボタン(ブラウザによっては
              datetime-local入力のクリア手段が無いため) */}
          {visitedOn && (
            <button
              type="button"
              onClick={() => onVisitedOnChange("")}
              className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600"
            >
              削除
            </button>
          )}
        </div>
        {earliestTakenAt && takenAtValue && takenAtValue !== visitedOn && (
          <button
            type="button"
            onClick={() => onVisitedOnChange(takenAtValue)}
            className="mt-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700"
          >
            写真の撮影日時にする(
            {earliestTakenAt.toLocaleString("ja-JP", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
            )
          </button>
        )}
        <p className="mt-1 text-xs text-gray-400">
          {/* **既定は現在日時が入っている。** 「空欄のままにすると」では、
              自分で消さないと空にならないことが読み取れない */}
          {visitedOnHint ?? "「削除」で空にすると「時期不明」として記録されます。"}
        </p>
      </div>

      <VisitPhotoFields
        photos={photos}
        onPhotosChange={onPhotosChange}
        onProcessingChange={onProcessingChange}
        onEarliestTakenAtChange={setEarliestTakenAt}
      />

      <div className="border-t border-gray-100 pt-3">
        <label className="mb-1 block text-sm font-medium">メモ(非公開)</label>
        <textarea
          value={memo}
          onChange={(e) => onMemoChange(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          placeholder="感想、同行者、天気など"
        />
      </div>
    </>
  );
}
