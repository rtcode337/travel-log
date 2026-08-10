"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { formatPlanDateRange } from "@/lib/planListDraft";
import type { Spot, VisitPlanList } from "@/lib/types";
import type { SeriesStyleDefinition } from "@/lib/seriesStyle";
import SeriesBadge from "@/components/SeriesBadge";
import GoogleMapsRouteLink from "@/components/GoogleMapsRouteLink";

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
  onChanged,
}: {
  listId: string;
  spotsById: Map<string, Spot>;
  seriesStyles: SeriesStyleDefinition[];
  onClose: () => void;
  /** 「編集」で呼ばれる。読み込み済みのリスト内容を渡す(呼び出し側で編集フローへ) */
  onEdit: (list: VisitPlanList) => void;
  onDeleted: () => void;
  onOpenSpot: (spotId: string) => void;
  /** 経由スポットの訪問済みを付け外ししたときに呼ばれる(呼び出し側の一覧の取り直し用) */
  onChanged?: () => void;
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

  const visitedIds = new Set(list?.visited_spot_ids ?? []);

  // 経由スポットの「訪問済み」を手で付け外しする。訪問記録を付ければ自動で付くが、
  // 記録するほどでもない立ち寄りや、誤って付けた分をここで直せる
  const [togglingSpotId, setTogglingSpotId] = useState<string | null>(null);
  const toggleVisited = async (spotId: string, visited: boolean) => {
    if (!list) return;
    setTogglingSpotId(spotId);
    setError(null);
    const { data, error } = await api.visitPlanLists.setItemVisited(
      list.id,
      spotId,
      visited
    );
    setTogglingSpotId(null);
    if (error) {
      setError("訪問済みの更新に失敗しました: " + error.message);
      return;
    }
    if (data) setList(data);
    onChanged?.();
  };

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
                  {visitedIds.size > 0 && `(訪問済み ${visitedIds.size})`}
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
                const visited = visitedIds.has(spotId);
                return (
                  <li
                    key={spotId}
                    className={`flex items-center ${visited ? "bg-gray-50" : ""}`}
                  >
                    <button
                      type="button"
                      disabled={!spot}
                      onClick={() => spot && onOpenSpot(spot.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 disabled:opacity-60"
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
                            <p
                              className={`truncate text-sm font-medium ${
                                visited ? "text-gray-400 line-through" : ""
                              }`}
                            >
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
                    {/* 訪問済みの付け外し。訪問記録を付ければ自動で付くが、ここでも直せる
                        (訪問済みは経路から外れるだけで、リストからは消えない) */}
                    <button
                      type="button"
                      onClick={() => toggleVisited(spotId, !visited)}
                      disabled={togglingSpotId === spotId}
                      aria-pressed={visited}
                      title={
                        visited
                          ? "訪問済み(経路から外れています)。タップで未訪問に戻す"
                          : "タップで訪問済みにする(経路から外れます)"
                      }
                      className={`mr-2 shrink-0 rounded-full border px-2 py-1 text-xs disabled:opacity-50 ${
                        visited
                          ? "border-green-600 bg-green-600 text-white"
                          : "border-gray-300 text-gray-500"
                      }`}
                    >
                      {visited ? "訪問済み" : "未訪問"}
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

            {/* 残りのスポットをGoogle マップの経路検索で開く(途中のスポットは経由地、
                最後のスポットは目的地になる)。読み込めていないスポットは飛ばし、
                訪問済みも外す —— 地図の経路と同じで、これから回る先だけを繋ぐ */}
            <div className="mt-3">
              <GoogleMapsRouteLink
                points={list.spot_ids.flatMap((id) => {
                  if (visitedIds.has(id)) return [];
                  const spot = spotsById.get(id) ?? extraSpots.get(id);
                  return spot ? [{ lat: spot.lat, lng: spot.lng }] : [];
                })}
              />
            </div>

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
