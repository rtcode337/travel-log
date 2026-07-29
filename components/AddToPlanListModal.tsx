"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { formatPlanDateRange } from "@/lib/planListDraft";
import type { VisitPlanList } from "@/lib/types";
import VisitPlanListFormModal from "@/components/VisitPlanListFormModal";

/**
 * スポット詳細から「訪問予定リストへ追加」したときに開くモーダル。
 * ・「新しいリストを作成」→ 作成フォーム(このスポットを最初の経由スポットとして種にする)
 * ・既存リストの一覧 → タップでそのリストの末尾にスポットを追加(PATCH)
 * 既にそのスポットを含むリストは「追加済み」で無効表示にする。
 */
export default function AddToPlanListModal({
  spotId,
  spotName,
  typeKey,
  onClose,
  onAdded,
}: {
  spotId: string;
  /** 見出しに出すスポット名(任意) */
  spotName?: string;
  typeKey: string;
  onClose: () => void;
  /** 既存リストへの追加が成功したときに呼ばれる(呼び出し元の一覧再取得用) */
  onAdded?: () => void;
}) {
  const [lists, setLists] = useState<VisitPlanList[] | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  useEffect(() => {
    api.visitPlanLists.list(typeKey).then(({ data }) => {
      setLists(data ?? []);
    });
  }, [typeKey]);

  const handleAddToExisting = async (list: VisitPlanList) => {
    if (list.spot_ids.includes(spotId)) return;
    setAddingId(list.id);
    setError(null);
    const { error } = await api.visitPlanLists.update(list.id, {
      title: list.title,
      description: list.description,
      start_date: list.start_date,
      end_date: list.end_date,
      spot_ids: [...list.spot_ids, spotId],
    });
    setAddingId(null);
    if (error) {
      setError("追加に失敗しました: " + error.message);
      return;
    }
    onAdded?.();
    onClose();
  };

  // 新しいリストを作成する場合はフォームへ。フォームで「スポットを選ぶ」を押すと
  // 地図の作成モードへ遷移する(このスポットは種として既に入っている)
  if (showNewForm) {
    return (
      <VisitPlanListFormModal
        typeKey={typeKey}
        initialSpotIds={[spotId]}
        onClose={() => setShowNewForm(false)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="font-bold">訪問予定リストへ追加</h2>
          {spotName && (
            <p className="mt-0.5 truncate text-xs text-gray-500">{spotName}</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowNewForm(true)}
          className="w-full rounded-lg border border-blue-600 py-2 text-sm font-medium text-blue-600"
        >
          ＋ 新しいリストを作成
        </button>

        <div className="pt-1">
          <p className="mb-1 text-xs font-medium text-gray-500">
            既存のリストに追加
          </p>
          {lists === null ? (
            <p className="py-2 text-sm text-gray-500">読み込み中…</p>
          ) : lists.length === 0 ? (
            <p className="py-2 text-sm text-gray-500">
              まだ訪問予定リストがありません。
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
              {lists.map((list) => {
                const already = list.spot_ids.includes(spotId);
                return (
                  <li key={list.id}>
                    <button
                      type="button"
                      disabled={already || addingId !== null}
                      onClick={() => handleAddToExisting(list)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 disabled:cursor-default disabled:opacity-60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {list.title}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatPlanDateRange(list.start_date, list.end_date)}・
                          {list.spot_ids.length}件
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-gray-400">
                        {already
                          ? "追加済み"
                          : addingId === list.id
                            ? "追加中…"
                            : "＋"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-lg border border-gray-300 py-2 text-sm text-gray-600"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
