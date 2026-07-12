"use client";

import { useMemo } from "react";
import { distinctValues, type Rank, type Spot } from "@/lib/types";
import { getRankBadgeStyle, getRankOrder } from "@/lib/rankStyle";

export type VisitedFilter = "all" | "visited" | "unvisited";

export interface SpotFilters {
  /** 空配列 = ランクによる絞り込みなし(全件表示) */
  ranks: Rank[];
  visited: VisitedFilter;
  category: string; // "all" またはカテゴリ名
}

export const DEFAULT_FILTERS: SpotFilters = {
  ranks: [],
  visited: "all",
  category: "all",
};

/**
 * フィルタを通過するか判定する(地図・リスト共通ロジック)。
 * hiddenRanks(現在アクティブなスポット種類のspot_types.hidden_ranks)に含まれるランクは、
 * ランクフィルタで明示的に選んだときだけ表示する(既定では除外)。
 * サーバー側(GET /api/spots)でも同じ既定除外をしているので、hiddenRanksを明示的に
 * 選んでいない限りそもそも該当スポットはfetchされない想定だが、二重に防御している。
 */
export function passesFilters(
  filters: SpotFilters,
  rank: Rank | null,
  category: string | null,
  isVisited: boolean,
  hiddenRanks: string[] = []
): boolean {
  if (filters.ranks.length > 0) {
    if (rank === null || !filters.ranks.includes(rank)) return false;
  } else if (rank !== null && hiddenRanks.includes(rank)) {
    return false;
  }
  if (filters.visited === "visited" && !isVisited) return false;
  if (filters.visited === "unvisited" && isVisited) return false;
  if (filters.category !== "all" && filters.category !== category) return false;
  return true;
}

const visitedOptions: { value: VisitedFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "visited", label: "訪問済み" },
  { value: "unvisited", label: "未訪問" },
];

export default function FilterBar({
  spots,
  filters,
  onChange,
  hiddenRanks = [],
}: {
  /** 現在アクティブなスポット種類の実データから、ランク・カテゴリの選択肢を動的に作る */
  spots: Spot[];
  filters: SpotFilters;
  onChange: (filters: SpotFilters) => void;
  /** アクティブなスポット種類のspot_types.hidden_ranks。未取得でもボタンは出せるよう
   * distinctValues(spots)とは別に渡す */
  hiddenRanks?: string[];
}) {
  const availableRanks = useMemo(
    () =>
      distinctValues([...spots.map((s) => s.rank), ...hiddenRanks]).sort(
        (a, b) => getRankOrder(a) - getRankOrder(b)
      ),
    [spots, hiddenRanks]
  );
  const availableCategories = useMemo(
    () => distinctValues(spots.map((s) => s.category)),
    [spots]
  );

  // 既定(filters.ranks === [])で実際にアクティブなランクは「hiddenRanks以外の全て」
  const defaultActiveRanks = useMemo(
    () => availableRanks.filter((r) => !hiddenRanks.includes(r)),
    [availableRanks, hiddenRanks]
  );

  const toggleRank = (rank: string) => {
    const current = filters.ranks.length > 0 ? filters.ranks : defaultActiveRanks;
    const ranks = current.includes(rank)
      ? current.filter((r) => r !== rank)
      : [...current, rank];
    // hiddenRanksを含まない状態で全ランクが揃ったときだけ「フィルタなし(既定)」に戻す
    const collapsesToDefault =
      !ranks.some((r) => hiddenRanks.includes(r)) &&
      ranks.length >= defaultActiveRanks.length;
    onChange({
      ...filters,
      ranks: collapsesToDefault ? [] : ranks,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {availableRanks.length > 0 && (
        <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white">
          {availableRanks.map((rank) => {
            const active =
              filters.ranks.length > 0
                ? filters.ranks.includes(rank)
                : !hiddenRanks.includes(rank);
            return (
              <button
                key={rank}
                onClick={() => toggleRank(rank)}
                className={`px-3 py-1.5 font-bold ${
                  active ? getRankBadgeStyle(rank) : "bg-white text-gray-300"
                }`}
              >
                {rank}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white">
        {visitedOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange({ ...filters, visited: opt.value })}
            className={`px-3 py-1.5 ${
              filters.visited === opt.value
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-500"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {availableCategories.length > 0 && (
        <select
          value={filters.category}
          onChange={(e) => onChange({ ...filters, category: e.target.value })}
          className="rounded-lg border border-gray-300 bg-white px-2 py-1.5"
        >
          <option value="all">全カテゴリ</option>
          {availableCategories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
