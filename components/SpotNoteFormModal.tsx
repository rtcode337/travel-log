"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { type SpotNote } from "@/lib/types";
import { toDateTimeLocalValue } from "@/lib/visitPhoto";

/**
 * 未訪問記録の入力モーダル(新規・編集共用)。訪問記録(VisitFormModal)と違い、
 * 写真・口コミは持たず日時(任意)+メモ(必須)だけの軽い記録にしてある
 * (「休みでちゃんと見られなかった」「下調べのメモ」を書き留める用途のため)。
 */
export default function SpotNoteFormModal({
  spotId,
  spotName,
  note,
  onClose,
  onSaved,
}: {
  spotId: string;
  spotName: string;
  /** 指定すると既存の未訪問記録の編集モードになる */
  note?: SpotNote;
  onClose: () => void;
  onSaved: () => void;
}) {
  // 日時は任意(下調べのメモには日時が無い)。編集時は既存値から始める。
  // datetime-localはローカル時刻を扱うため、UTCのISO文字列から変換する
  const [notedOn, setNotedOn] = useState(() =>
    note?.noted_on ? toDateTimeLocalValue(new Date(note.noted_on)) : ""
  );
  const [memo, setMemo] = useState(note?.memo ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memo.trim()) {
      setError("メモを入力してください。");
      return;
    }
    setSaving(true);
    setError(null);

    // ローカル時刻の入力値をISO 8601(UTC)にしてから送る(visitsと同じ理由)
    const payload = {
      noted_on: notedOn ? new Date(notedOn).toISOString() : null,
      memo: memo.trim(),
    };
    const { error: saveError } = note
      ? await api.spotNotes.update(note.id, payload)
      : await api.spotNotes.create({ spot_id: spotId, ...payload });
    if (saveError) {
      setSaving(false);
      setError("保存に失敗しました: " + saveError.message);
      return;
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
        <h2 className="mb-1 font-bold">
          {note ? "未訪問記録を編集" : "未訪問記録を追加"}
        </h2>
        <p className="mb-1 text-sm text-gray-500">{spotName}</p>
        <p className="mb-4 text-xs text-gray-400">
          訪問したけれど休みや時間の都合でちゃんと見られなかったときや、
          事前の下調べをメモしておくための非公開の記録です。訪問済みにはなりません。
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">日時(任意)</label>
            <input
              type="datetime-local"
              value={notedOn}
              onChange={(e) => setNotedOn(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-400">
              訪問を試みた日時など。下調べのメモだけなら空欄のままでかまいません。
            </p>
          </div>

          <div className="border-t border-gray-100 pt-3">
            <label className="mb-1 block text-sm font-medium">メモ(非公開)</label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="休館日だった、営業時間、行き方の下調べなど"
            />
          </div>

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
              disabled={saving}
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
