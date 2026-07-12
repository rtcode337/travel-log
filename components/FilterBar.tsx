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

/** フィルタを通過するか判定する(地図・リスト共通ロジック) */
export function passesFilters(
  filters: SpotFilters,
  rank: Rank | null,
  category: string | null,
  isVisited: boolean
): boolean {
  if (
    filters.ranks.length > 0 &&
    (rank === null || !filters.ranks.includes(rank))
  ) {
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
}: {
  /** 現在アクティブなスポット種類の実データから、ランク・カテゴリの選択肢を動的に作る */
  spots: Spot[];
  filters: SpotFilters;
  onChange: (filters: SpotFilters) => void;
}) {
  const availableRanks = useMemo(
    () =>
      distinctValues(spots.map((s) => s.rank)).sort(
        (a, b) => getRankOrder(a) - getRankOrder(b)
      ),
    [spots]
  );
  const availableCategories = useMemo(
    () => distinctValues(spots.map((s) => s.category)),
    [spots]
  );

  const toggleRank = (rank: string) => {
    const current = filters.ranks.length > 0 ? filters.ranks : availableRanks;
    const ranks = current.includes(rank)
      ? current.filter((r) => r !== rank)
      : [...current, rank];
    onChange({
      ...filters,
      ranks: ranks.length >= availableRanks.length ? [] : ranks,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {availableRanks.length > 0 && (
        <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white">
          {availableRanks.map((rank) => {
            const active =
              filters.ranks.length === 0 || filters.ranks.includes(rank);
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
