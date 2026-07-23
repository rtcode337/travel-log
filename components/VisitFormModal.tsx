"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { type Visit } from "@/lib/types";
import { toDateTimeLocalValue } from "@/lib/visitPhoto";
import VisitFields from "@/components/VisitFields";

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
  const [reviewBody, setReviewBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <VisitFields
            visitedOn={visitedOn}
            onVisitedOnChange={setVisitedOn}
            memo={memo}
            onMemoChange={setMemo}
            photos={photos}
            onPhotosChange={setPhotos}
            onProcessingChange={setProcessingPhotos}
          />

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
