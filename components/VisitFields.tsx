"use client";

import { useState } from "react";
import { readPhotoTakenAt } from "@/lib/exif";
import { visitPhotoSrc } from "@/lib/types";
import { resizeImageToDataUrl, toDateTimeLocalValue } from "@/lib/visitPhoto";
import { photosEnabled } from "@/lib/features";

/**
 * 訪問記録の入力欄(訪問日時・写真・メモ)。訪問記録モーダル(VisitFormModal)と、
 * スポット追加時の「訪問を記録する」(AddSpotModal)で共用する。写真は「既存の相対パス」
 * または「追加写真のdata URL」の混在で親が保持し、この形のまま保存に渡す。
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
  // photosと同じ並びの各写真のExif撮影日時(取得できなければnull)。既存写真は
  // 元ファイルが手元に無くExifを読めないためnull。add/removeはこの中で並行して更新する
  const [photoTakenAts, setPhotoTakenAts] = useState<(Date | null)[]>(() =>
    photos.map(() => null)
  );
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setProcessing(true);
    onProcessingChange?.(true);
    setError(null);
    try {
      // 撮影日時は縮小前の元ファイルから読む(canvasで描き直すとExifは失われる)
      const takenAts = await Promise.all(files.map(readPhotoTakenAt));
      const dataUrls = await Promise.all(files.map(resizeImageToDataUrl));
      onPhotosChange([...photos, ...dataUrls]);
      setPhotoTakenAts((prev) => [...prev, ...takenAts]);
    } catch {
      setError("写真の読み込みに失敗しました。");
    } finally {
      setProcessing(false);
      onProcessingChange?.(false);
    }
  };

  const removePhoto = (index: number) => {
    onPhotosChange(photos.filter((_, i) => i !== index));
    setPhotoTakenAts((prev) => prev.filter((_, i) => i !== index));
  };

  // 複数枚を選んだときは最も古い撮影日時=その場所に着いた時刻を採用する
  const earliestTakenAt = photoTakenAts.reduce<Date | null>(
    (earliest, takenAt) =>
      takenAt && (!earliest || takenAt < earliest) ? takenAt : earliest,
    null
  );
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

      {/* 写真を畳んだ環境(lib/features.ts)でも、既に付いている写真は出す
          —— 畳んだ理由は「これ以上増やさない」であって、記録済みのものを
          見せない・消せなくする理由は無い。増やす側(選択ボタン)だけを消す */}
      {(photosEnabled || photos.length > 0) && (
      <div className="border-t border-gray-100 pt-3">
        <label className="mb-1 block text-sm font-medium">写真(非公開)</label>
        {photosEnabled && (
          <p className="mb-2 text-xs text-gray-400">
            自分だけに表示されます。他のユーザーには公開されません。
            <br />
            ※ 保存時に縮小・圧縮されます(長辺1280px・JPEG)。キレイに残したい写真は、
            元のデータを手元に保管しておいてください。
          </p>
        )}
        {photos.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {photos.map((photo, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.startsWith("data:") ? photo : visitPhotoSrc(photo)}
                  alt=""
                  className="h-16 w-16 rounded-lg object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-xs text-white"
                  aria-label="写真を削除"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {photosEnabled ? (
          <label className="inline-block cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600">
            {processing ? "読み込み中…" : "+ 写真を選択"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={processing}
              onChange={handlePhotoChange}
            />
          </label>
        ) : (
          <p className="text-xs text-gray-400">
            この環境では写真の追加を利用できません。
          </p>
        )}
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
      )}

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
