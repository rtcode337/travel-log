"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { formatPlanDateRange } from "@/lib/planListDraft";
import type { Spot, VisitPlanList } from "@/lib/types";
import type { SeriesStyleDefinition } from "@/lib/seriesStyle";
import SeriesBadge from "@/components/SeriesBadge";

/**
 * 訪問予定リスト(旅程)の詳細モーダル。タイトル・説明・訪問予定期間と、
 * 経由スポットをseq順に表示する。スポットのタップで各スポット詳細へ、
 * リスト自体の削除もできる。スポットの詳細は呼び出し側が保持済みの一覧から解決する。
 */
export default function VisitPlanListDetailModal({
  listId,
  spotsById,
  seriesStyles,
  onClose,
  onEdit,
  onDeleted,
  onOpenSpot,
}: {
  listId: string;
  spotsById: Map<string, Spot>;
  seriesStyles: SeriesStyleDefinition[];
  onClose: () => void;
  /** 「編集」で呼ばれる。読み込み済みのリスト内容を渡す(呼び出し側で編集フローへ) */
  onEdit: (list: VisitPlanList) => void;
  onDeleted: () => void;
  onOpenSpot: (spotId: string) => void;
}) {
  const [list, setList] = useState<VisitPlanList | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 呼び出し側の spotsById に無い(＝別スポット種別を重ねて追加した)スポットを
  // IDから個別取得して補完する。resolvedRef で一度取得したIDの再取得を防ぐ
  const [extraSpots, setExtraSpots] = useState<Map<string, Spot>>(new Map());
  const resolvedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    api.visitPlanLists.get(listId).then(({ data }) => {
      setList(data ?? null);
      setLoading(false);
    });
  }, [listId]);

  // 別種別スポット(spotsById に無いID)を api.spots.get で解決する
  useEffect(() => {
    if (!list) return;
    const missing = list.spot_ids.filter(
      (id) => !spotsById.has(id) && !resolvedRef.current.has(id)
    );
    if (missing.length === 0) return;
    missing.forEach((id) => resolvedRef.current.add(id));
    let cancelled = false;
    Promise.all(missing.map((id) => api.spots.get(id))).then((results) => {
      if (cancelled) return;
      setExtraSpots((prev) => {
        const next = new Map(prev);
        for (const { data } of results) if (data) next.set(data.id, data);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [list, spotsById]);

  const handleDelete = async () => {
    if (!list) return;
    if (!confirm(`「${list.title}」を削除しますか?`)) return;
    setDeleting(true);
    setError(null);
    const { error } = await api.visitPlanLists.delete(list.id);
    setDeleting(false);
    if (error) {
      setError("削除に失敗しました: " + error.message);
      return;
    }
    onDeleted();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <p className="p-4 text-sm text-gray-500">読み込み中…</p>
        ) : !list ? (
          <p className="p-4 text-sm text-gray-500">
            リストが見つかりません。
          </p>
        ) : (
          <>
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-lg font-bold leading-tight">{list.title}</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  {formatPlanDateRange(list.start_date, list.end_date)}
                  {" ・ "}
                  {list.spot_ids.length}スポット
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="閉じる"
                className="rounded-full px-2 text-xl leading-none text-gray-400"
              >
                ×
              </button>
            </div>

            {list.description && (
              <p className="mb-3 whitespace-pre-wrap text-sm text-gray-700">
                {list.description}
              </p>
            )}

            <ol className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
              {list.spot_ids.map((spotId, i) => {
                const spot = spotsById.get(spotId) ?? extraSpots.get(spotId);
                return (
                  <li key={spotId}>
                    <button
                      type="button"
                      disabled={!spot}
                      onClick={() => spot && onOpenSpot(spot.id)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 disabled:opacity-60"
                    >
                      <span className="w-5 shrink-0 text-right text-xs font-medium tabular-nums text-gray-400">
                        {i + 1}
                      </span>
                      {spot ? (
                        <>
                          <SeriesBadge
                            series={spot.series}
                            seriesStyles={seriesStyles}
                            isPrivate={spot.status === "private"}
                            size="sm"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {spot.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {spot.region}
                            </p>
                          </div>
                          <span className="shrink-0 text-gray-400">›</span>
                        </>
                      ) : (
                        <span className="text-sm text-gray-400">
                          (読み込まれていないスポット)
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
              {list.spot_ids.length === 0 && (
                <li className="px-3 py-3 text-sm text-gray-500">
                  スポットがありません。
                </li>
              )}
            </ol>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <button
              type="button"
              onClick={() => onEdit(list)}
              className="mt-4 w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white"
            >
              このリストを編集
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="mt-2 w-full rounded-lg border border-red-300 py-2 text-sm text-red-600 disabled:opacity-50"
            >
              {deleting ? "削除中…" : "このリストを削除"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
