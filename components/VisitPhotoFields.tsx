"use client";

import { useState } from "react";
import { readPhotoTakenAt } from "@/lib/exif";
import { visitPhotoSrc } from "@/lib/types";
import { resizeImageToDataUrl } from "@/lib/visitPhoto";
import { photosEnabled } from "@/lib/features";

/**
 * 写真の選択欄。訪問記録の入力(`VisitFields`)と、訪問記録への追記
 * (`VisitNoteFormModal`)で共用する —— 縮小・Exif読み取り・枚数の扱いを
 * 2か所に書くと、片方だけ直したときに保存できる写真が食い違う。
 *
 * 写真は「既存の相対パス(残す)」または「追加写真のdata URL」の混在で親が保持し、
 * この形のまま保存に渡す。撮影日時(Exif)は**縮小前の元ファイル**から読む
 * (canvasで描き直すと失われる)。使うのは訪問日時を埋める側だけなので、
 * ここでは読んで親へ渡すところまでを受け持つ。
 */
export default function VisitPhotoFields({
  photos,
  onPhotosChange,
  onProcessingChange,
  onEarliestTakenAtChange,
  hint,
}: {
  photos: string[];
  onPhotosChange: (photos: string[]) => void;
  /** 写真の縮小処理中を親へ伝える(送信ボタンのdisable用) */
  onProcessingChange?: (processing: boolean) => void;
  /** 選択中の写真のうち最も古い撮影日時(=その場所に着いた時刻)。無ければnull */
  onEarliestTakenAtChange?: (takenAt: Date | null) => void;
  /** 説明文の差し替え(既定は訪問記録向けの文面) */
  hint?: React.ReactNode;
}) {
  // photosと同じ並びの各写真のExif撮影日時(取得できなければnull)。既存写真は
  // 元ファイルが手元に無くExifを読めないためnull
  const [photoTakenAts, setPhotoTakenAts] = useState<(Date | null)[]>(() =>
    photos.map(() => null)
  );
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 複数枚を選んだときは最も古い撮影日時を採用する
  const applyTakenAts = (takenAts: (Date | null)[]) => {
    setPhotoTakenAts(takenAts);
    onEarliestTakenAtChange?.(
      takenAts.reduce<Date | null>(
        (earliest, takenAt) =>
          takenAt && (!earliest || takenAt < earliest) ? takenAt : earliest,
        null
      )
    );
  };

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
      applyTakenAts([...photoTakenAts, ...takenAts]);
    } catch {
      setError("写真の読み込みに失敗しました。");
    } finally {
      setProcessing(false);
      onProcessingChange?.(false);
    }
  };

  const removePhoto = (index: number) => {
    onPhotosChange(photos.filter((_, i) => i !== index));
    applyTakenAts(photoTakenAts.filter((_, i) => i !== index));
  };

  // 写真を畳んだ環境(lib/features.ts)でも、既に付いている写真は出す
  // —— 畳んだ理由は「これ以上増やさない」であって、記録済みのものを
  // 見せない・消せなくする理由は無い。増やす側(選択ボタン)だけを消す
  if (!photosEnabled && photos.length === 0) return null;

  return (
    <div className="border-t border-gray-100 pt-3">
      <label className="mb-1 block text-sm font-medium">写真(非公開)</label>
      {photosEnabled &&
        (hint ?? (
          <p className="mb-2 text-xs text-gray-400">
            自分だけに表示されます。他のユーザーには公開されません。
            <br />
            ※ 保存時に縮小・圧縮されます(長辺1280px・JPEG)。キレイに残したい写真は、
            元のデータを手元に保管しておいてください。
          </p>
        ))}
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
  );
}
