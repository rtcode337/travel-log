"use client";

import { CATEGORIES, RANKS, type Rank } from "@/lib/types";

// RankBadge/MapViewと同じ配色
const activeRankStyles: Record<Rank, string> = {
  S: "bg-[#f59e0b] text-[#451a03]",
  A: "bg-[#a7f3d0] text-[#065f46]",
  B: "bg-[#93c5fd] text-[#1e3a8a]",
  C: "bg-white text-gray-700 border border-gray-300",
  D: "bg-[#e5e7eb] text-gray-700",
};

export type VisitedFilter = "all" | "visited" | "unvisited";

export interface SpotFilters {
  ranks: Rank[];
  visited: VisitedFilter;
  category: string; // "all" またはカテゴリ名
}

export const DEFAULT_FILTERS: SpotFilters = {
  ranks: [...RANKS],
  visited: "all",
  category: "all",
};

/** フィルタを通過するか判定する(地図・リスト共通ロジック) */
export function passesFilters(
  filters: SpotFilters,
  rank: Rank,
  category: string,
  isVisited: boolean
): boolean {
  if (!filters.ranks.includes(rank)) return false;
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
  filters,
  onChange,
}: {
  filters: SpotFilters;
  onChange: (filters: SpotFilters) => void;
}) {
  const toggleRank = (rank: Rank) => {
    const ranks = filters.ranks.includes(rank)
      ? filters.ranks.filter((r) => r !== rank)
      : [...filters.ranks, rank];
    onChange({ ...filters, ranks });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white">
        {RANKS.map((rank) => (
          <button
            key={rank}
            onClick={() => toggleRank(rank)}
            className={`px-3 py-1.5 font-bold ${
              filters.ranks.includes(rank)
                ? activeRankStyles[rank]
                : "bg-white text-gray-300"
            }`}
          >
            {rank}
          </button>
        ))}
      </div>
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
      <select
        value={filters.category}
        onChange={(e) => onChange({ ...filters, category: e.target.value })}
        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5"
      >
        <option value="all">全カテゴリ</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </div>
  );
}
