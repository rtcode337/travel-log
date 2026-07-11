"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DATE_PRECISIONS, type DatePrecision } from "@/lib/types";

export default function VisitFormModal({
  spotId,
  spotName,
  onClose,
  onSaved,
}: {
  spotId: string;
  spotName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [visitedOn, setVisitedOn] = useState(today);
  const [precision, setPrecision] = useState<DatePrecision>("day");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("visits").insert({
      spot_id: spotId,
      visited_on: precision === "unknown" ? null : visitedOn || null,
      date_precision: precision,
      memo: memo.trim() || null,
    });
    setSaving(false);
    if (error) {
      setError("保存に失敗しました: " + error.message);
      return;
    }
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 font-bold">訪問を記録</h2>
        <p className="mb-4 text-sm text-gray-500">{spotName}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              日付の精度
            </label>
            <select
              value={precision}
              onChange={(e) => setPrecision(e.target.value as DatePrecision)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {DATE_PRECISIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {precision !== "unknown" && (
            <div>
              <label className="mb-1 block text-sm font-medium">訪問日</label>
              <input
                type="date"
                value={visitedOn}
                onChange={(e) => setVisitedOn(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              {precision !== "day" && (
                <p className="mt-1 text-xs text-gray-400">
                  ※ 表示時は{precision === "month" ? "年月" : "年"}
                  のみ使われます。日はおおよそでOK。
                </p>
              )}
            </div>
          )}
          <div>
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
