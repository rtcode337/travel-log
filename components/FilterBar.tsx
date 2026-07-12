"use client";

import { useMemo } from "react";
import { distinctValues, type Rank, type Spot } from "@/lib/types";
import { getRankOrder } from "@/lib/rankStyle";

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

  // <select>は単一選択なので、既に複数選択された状態(過去互換)は「すべて」扱いにする
  const selectedRank = filters.ranks.length === 1 ? filters.ranks[0] : "all";

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {availableRanks.length > 0 && (
        <select
          value={selectedRank}
          onChange={(e) =>
            onChange({
              ...filters,
              ranks: e.target.value === "all" ? [] : [e.target.value],
            })
          }
          className="rounded-lg border border-gray-300 bg-white px-2 py-1.5"
        >
          <option value="all">すべてのランク</option>
          {availableRanks.map((rank) => (
            <option key={rank} value={rank}>
              {rank}
            </option>
          ))}
        </select>
      )}
      <select
        value={filters.visited}
        onChange={(e) =>
          onChange({ ...filters, visited: e.target.value as VisitedFilter })
        }
        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5"
      >
        {visitedOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
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
