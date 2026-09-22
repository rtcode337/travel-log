"use client";

import { useState } from "react";
import { readPhotoTakenAt } from "@/lib/exif";
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
  // 「写真から読む」の結果(日時が入っていなかった・読めなかったときの断り)
  const [readNote, setReadNote] = useState<string | null>(null);

  /**
   * 手元の写真ファイルから撮影日時だけを読んで訪問日時に入れる。**写真は添付しない**。
   *
   * **保存済みの写真からは読めない。** 添付した写真は保存前にcanvasで縮小・再圧縮して
   * いるので、その時点でExifごと落ちている(`lib/visitPhoto.ts`)。あとから記録を開いて
   * 日時を直したいときに頼れるのは手元に残っている元ファイルのほうなので、
   * **写真を足さずに日時だけ拾う入口**を別に置いてある。
   *
   * こちらは利用者がそのために選んだファイルなので、**確認のボタンを挟まず直接入れる**
   * (添付した写真から読むほうは「入れるかどうか」が別の意思なのでボタンのまま)。
   */
  const handleReadTakenAt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setReadNote(null);
    try {
      const takenAts = await Promise.all(files.map(readPhotoTakenAt));
      // 複数枚選んだときは最も古いもの(添付した写真から読むときと同じ扱い)
      const earliest = takenAts.reduce<Date | null>(
        (found, takenAt) =>
          takenAt && (!found || takenAt < found) ? takenAt : found,
        null
      );
      if (!earliest) {
        setReadNote("この写真には撮影日時が入っていませんでした。");
        return;
      }
      onVisitedOnChange(toDateTimeLocalValue(earliest));
    } catch {
      setReadNote("写真を読み込めませんでした。");
    }
  };

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
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {/* 手元の写真から日時だけ読む。保存済みの写真にはExifが残っていないので、
              あとから日時を直すときはこちらから元ファイルを選ぶ */}
          <label className="cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600">
            写真から読む
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleReadTakenAt}
              className="hidden"
            />
          </label>
          {readNote && <span className="text-xs text-gray-500">{readNote}</span>}
        </div>
        {earliestTakenAt && takenAtValue && takenAtValue !== visitedOn && (
          <button
            type="button"
            onClick={() => onVisitedOnChange(takenAtValue)}
            className="mt-1.5 block rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700"
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
