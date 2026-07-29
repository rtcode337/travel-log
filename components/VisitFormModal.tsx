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
  /** 保存後に、保存された訪問記録とともに呼ばれる(呼び出し元が未訪問記録かどうか・
   *  日時の有無で後続処理(訪問予定リストからの自動除外など)を出し分けるのに使う) */
  onSaved: (saved?: Visit) => void;
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
  // 未訪問記録(訪問済みに数えない記録)にするか。編集時は既存値から始める
  const [unvisited, setUnvisited] = useState(visit?.unvisited ?? false);
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
      unvisited,
    };
    const { data: saved, error: visitError } = visit
      ? await api.visits.update(visit.id, payload)
      : await api.visits.create(payload);
    if (visitError) {
      setSaving(false);
      setError("保存に失敗しました: " + visitError.message);
      return;
    }

    if (!visit && reviewsEnabled && !unvisited && reviewBody.trim()) {
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
    onSaved(saved ?? undefined);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 font-bold">
          {visit
            ? unvisited
              ? "未訪問記録を編集"
              : "訪問記録を編集"
            : unvisited
              ? "未訪問記録を追加"
              : "訪問を記録"}
        </h2>
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
            visitedOnHint={
              unvisited
                ? "空欄のままなら下調べのメモになります(どの経路にも含まれず、訪問予定も残ります)。"
                : undefined
            }
          />

          {/* 未訪問記録の切り替え。訪問記録と同じフォーム・同じ訪問履歴に記録し、
              訪問済みに数えるかどうかだけをこのフラグで分ける */}
          <div className="border-t border-gray-100 pt-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={unvisited}
                onChange={(e) => setUnvisited(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">未訪問記録にする(訪問済みにしない)</span>
                <span className="mt-0.5 block text-xs text-gray-400">
                  休みや時間の都合でちゃんと見られなかったときや、事前の下調べのメモに。
                  訪問日時を入れると「訪れたが改めて来たい」記録としてその日の経路に含まれ、
                  訪問予定からも外れます。訪問日時が空欄なら下調べのメモになり、
                  どの経路にも含まれず、訪問予定も残ります。
                </span>
              </span>
            </label>
          </div>

          {/* 口コミは訪問記録とは独立のデータのため、編集モードと未訪問記録では出さない */}
          {reviewsEnabled && !visit && !unvisited && (
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
