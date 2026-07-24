"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { savePlanListDraft } from "@/lib/planListDraft";
import type { VisitPlanList } from "@/lib/types";

/** 今日のローカル日付(`YYYY-MM-DD`)。開始日の初期値に使う */
function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 訪問予定リストの作成・編集モーダル(基本情報の入力)。タイトル・説明(任意)・
 * 訪問予定期間(開始日〜終了日。終了日未入力なら開始日と同じ=単日)を入力し、
 * 「スポットを選ぶ/編集」で下書きを保存して地図の作成モードへ遷移する。
 * `edit`を渡すと既存リストの編集(既存の経由スポットを引き継いで地図で編集し、
 * 入力完了でPATCHする)。
 */
export default function VisitPlanListFormModal({
  typeKey,
  edit,
  onClose,
}: {
  typeKey: string;
  /** 指定すると編集モードになり、そのリストの内容を初期値にする */
  edit?: VisitPlanList;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(edit?.title ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  const [startDate, setStartDate] = useState(edit?.start_date ?? todayKey());
  // 単日(開始=終了)は終了日欄を空表示にする(新規と同じ扱い)
  const [endDate, setEndDate] = useState(
    edit && edit.end_date !== edit.start_date ? edit.end_date : ""
  );
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setError("タイトルを入力してください。");
      return;
    }
    if (!startDate) {
      setError("開始日を入力してください。");
      return;
    }
    // 終了日が空なら開始日と同じ(単日)にする
    const end = endDate || startDate;
    if (end < startDate) {
      setError("終了日は開始日以降にしてください。");
      return;
    }
    savePlanListDraft(typeKey, {
      editingId: edit?.id ?? null,
      title: t,
      description: description.trim() || null,
      start_date: startDate,
      end_date: end,
      // 編集時は既存の経由スポットを引き継いで地図で編集する
      spotIds: edit?.spot_ids ?? [],
    });
    // 地図の作成モードへ。?buildList=1 でMapViewが下書きを読み込んで作成モードに入る
    router.push(`/${typeKey}/map?buildList=1`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl"
      >
        <h2 className="font-bold">
          {edit ? "訪問予定リストを編集" : "訪問予定リストを追加"}
        </h2>
        <p className="text-xs text-gray-500">
          リストの基本情報を入力してから、地図でスポットを{edit ? "編集" : "選び"}ます。
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium">タイトル *</label>
          <input
            required
            autoComplete="off"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: 夏の北海道旅行"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">説明</label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-sm font-medium">開始日 *</label>
            <input
              required
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">終了日</label>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            />
          </div>
        </div>
        <p className="text-xs text-gray-400">
          終了日を空にすると、開始日と同じ日(単日)になります。
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm"
          >
            キャンセル
          </button>
          <button
            type="submit"
            className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white"
          >
            {edit ? "スポットを編集 →" : "スポットを選ぶ →"}
          </button>
        </div>
      </form>
    </div>
  );
}
