"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { readPhotoTakenAt } from "@/lib/exif";
import { visitPhotoSrc, type Visit } from "@/lib/types";

const MAX_PHOTO_SIZE = 1280;

/** Dateをdatetime-localのvalue(ローカル時刻の`YYYY-MM-DDTHH:mm`)にする */
function toDateTimeLocalValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function resizeImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("画像を読み込めませんでした"));
      img.onload = () => {
        const scale = Math.min(1, MAX_PHOTO_SIZE / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas is not supported"));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function VisitFormModal({
  spotId,
  spotName,
  reviewsEnabled,
  visit,
  onClose,
  onSaved,
}: {
  spotId: string;
  spotName: string;
  /** falseならこのスポット種別では口コミ機能が無効なので入力欄自体を出さない */
  reviewsEnabled: boolean;
  /** 指定すると既存の訪問記録の編集モードになる(口コミ入力欄は出さない) */
  visit?: Visit;
  onClose: () => void;
  onSaved: () => void;
}) {
  // datetime-localは「ローカル時刻のYYYY-MM-DDTHH:mm」を扱うため、現在時刻を
  // UTCではなくローカルのまま初期値にする(toISOStringだとUTCにずれる)。
  // 編集時は既存の訪問日時(未入力=時期不明なら空欄)から始める
  const [visitedOn, setVisitedOn] = useState(() =>
    visit
      ? visit.visited_on
        ? toDateTimeLocalValue(new Date(visit.visited_on))
        : ""
      : toDateTimeLocalValue(new Date())
  );
  const [memo, setMemo] = useState(visit?.memo ?? "");
  // 各要素は「既存写真の相対パス」または「追加写真のdata URL」。この形のまま
  // PATCHに渡す(サーバー側がパス=残す・data URL=新規保存と解釈する)
  const [photos, setPhotos] = useState<string[]>(visit?.photos ?? []);
  const [processingPhotos, setProcessingPhotos] = useState(false);
  // photosと同じ並びの、各写真のExif撮影日時(取得できなければnull)。
  // 「写真の撮影日時にする」ボタンの表示・適用値に使う(既存写真は元ファイルが
  // 手元に無くExifを読めないためnull)
  const [photoTakenAts, setPhotoTakenAts] = useState<(Date | null)[]>(() =>
    (visit?.photos ?? []).map(() => null)
  );
  const [reviewBody, setReviewBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setProcessingPhotos(true);
    try {
      // 撮影日時は縮小前の元ファイルから読む(canvasで描き直すとExifは失われる)
      const takenAts = await Promise.all(files.map(readPhotoTakenAt));
      const dataUrls = await Promise.all(files.map(resizeImageToDataUrl));
      setPhotos((prev) => [...prev, ...dataUrls]);
      setPhotoTakenAts((prev) => [...prev, ...takenAts]);
    } catch {
      setError("写真の読み込みに失敗しました。");
    } finally {
      setProcessingPhotos(false);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setPhotoTakenAts((prev) => prev.filter((_, i) => i !== index));
  };

  // 複数枚を選んだときは最も古い撮影日時=その場所に着いた時刻を採用する
  const earliestTakenAt = photoTakenAts.reduce<Date | null>(
    (earliest, takenAt) =>
      takenAt && (!earliest || takenAt < earliest) ? takenAt : earliest,
    null
  );
  const takenAtValue = earliestTakenAt ? toDateTimeLocalValue(earliestTakenAt) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    // ローカル時刻の入力値をISO 8601(UTC)にしてから送る。文字列のまま送ると
    // DB(timestamptz)がサーバーのタイムゾーンで解釈してずれる
    const payload = {
      spot_id: spotId,
      visited_on: visitedOn ? new Date(visitedOn).toISOString() : null,
      memo: memo.trim() || null,
      photos,
    };
    const { error: visitError } = visit
      ? await api.visits.update(visit.id, payload)
      : await api.visits.create(payload);
    if (visitError) {
      setSaving(false);
      setError("保存に失敗しました: " + visitError.message);
      return;
    }

    if (!visit && reviewsEnabled && reviewBody.trim()) {
      const { error: reviewError } = await api.reviews.create(
        spotId,
        reviewBody.trim()
      );
      if (reviewError) {
        setSaving(false);
        setError("訪問は記録しましたが、口コミの保存に失敗しました: " + reviewError.message);
        return;
      }
    }

    setSaving(false);
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 font-bold">{visit ? "訪問記録を編集" : "訪問を記録"}</h2>
        <p className="mb-4 text-sm text-gray-500">{spotName}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">訪問日時</label>
            <input
              type="datetime-local"
              value={visitedOn}
              onChange={(e) => setVisitedOn(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            {earliestTakenAt && takenAtValue && takenAtValue !== visitedOn && (
              <button
                type="button"
                onClick={() => setVisitedOn(takenAtValue)}
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
              空欄のままにすると「時期不明」として記録されます。
            </p>
          </div>
          <div className="border-t border-gray-100 pt-3">
            <label className="mb-1 block text-sm font-medium">
              写真(非公開)
            </label>
            <p className="mb-2 text-xs text-gray-400">
              自分だけに表示されます。他のユーザーには公開されません。
              <br />
              ※ 保存時に縮小・圧縮されます(長辺1280px・JPEG)。キレイに
              残したい写真は、元のデータを手元に保管しておいてください。
            </p>
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
            <label className="inline-block cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600">
              {processingPhotos ? "読み込み中…" : "+ 写真を選択"}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={processingPhotos}
                onChange={handlePhotoChange}
              />
            </label>
          </div>

          <div className="border-t border-gray-100 pt-3">
            <label className="mb-1 block text-sm font-medium">
              メモ(非公開)
            </label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="感想、同行者、天気など"
            />
          </div>

          {/* 口コミは訪問記録とは独立のデータのため、編集モードでは出さない */}
          {reviewsEnabled && !visit && (
            <div className="border-t border-gray-100 pt-3">
              <label className="mb-1 block text-sm font-medium">
                口コミ投稿(公開・任意)
              </label>
              <p className="mb-2 text-xs text-gray-400">
                他のユーザーにも公開されます。投稿するたびに新しい口コミとして
                追加されます(上書きはされません)。
              </p>
              <textarea
                value={reviewBody}
                onChange={(e) => setReviewBody(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="行ってみた感想など"
              />
            </div>
          )}

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
              type="submit"
              disabled={saving || processingPhotos}
              className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
