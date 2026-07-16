"use client";

import { useMemo } from "react";
import { distinctValues, type Rank, type Spot } from "@/lib/types";
import { getRankBadgeStyle, getRankOrder } from "@/lib/rankStyle";

export type VisitedValue = "visited" | "unvisited";

export interface SpotFilters {
  /** 空配列 = ランクによる絞り込みなし(「すべて」選択中、全件表示) */
  ranks: Rank[];
  /** 空配列 = 訪問状況による絞り込みなし(「すべて」選択中、全件表示) */
  visited: VisitedValue[];
}

export const DEFAULT_FILTERS: SpotFilters = {
  ranks: [],
  visited: [],
};

/**
 * フィルタを通過するか判定する(地図・リスト共通ロジック)。
 */
export function passesFilters(
  filters: SpotFilters,
  rank: Rank | null,
  isVisited: boolean
): boolean {
  if (filters.ranks.length > 0) {
    if (rank === null || !filters.ranks.includes(rank)) return false;
  }
  if (filters.visited.length > 0) {
    const value: VisitedValue = isVisited ? "visited" : "unvisited";
    if (!filters.visited.includes(value)) return false;
  }
  return true;
}

/**
 * 「すべて」(空配列)の状態から特定の1件を選ぶと、それ単独の絞り込みになる
 * (他をすべて手で外す手間を省くため)。それ以外は通常のトグル(追加/除外)。
 */
function toggleSelection<T>(current: T[], clicked: T): T[] {
  if (current.length === 0) return [clicked];
  return current.includes(clicked)
    ? current.filter((v) => v !== clicked)
    : [...current, clicked];
}

const VISITED_OPTIONS: { value: VisitedValue; label: string }[] = [
  { value: "visited", label: "訪問済み" },
  { value: "unvisited", label: "未訪問" },
];

function Chip({
  label,
  active,
  activeClassName,
  onClick,
}: {
  label: string;
  active: boolean;
  activeClassName: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 font-medium ${
        active ? activeClassName : "border-gray-300 bg-white text-gray-400"
      }`}
    >
      {label}
    </button>
  );
}

const ALL_CHIP_ACTIVE_CLASS = "border-blue-600 bg-blue-600 text-white";

export default function FilterBar({
  spots,
  filters,
  onChange,
}: {
  /** 現在アクティブなスポット種類の実データから、ランクの選択肢を動的に作る */
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

  return (
    <div className="space-y-3 text-sm">
      {availableRanks.length > 0 && (
        <div>
          <span className="mb-1 block text-xs font-medium text-gray-500">
            ランク
          </span>
          <div className="flex flex-wrap gap-1.5">
            {availableRanks.map((rank) => (
              <Chip
                key={rank}
                label={rank}
                active={filters.ranks.includes(rank)}
                activeClassName={getRankBadgeStyle(rank)}
                onClick={() =>
                  onChange({
                    ...filters,
                    ranks: toggleSelection(filters.ranks, rank),
                  })
                }
              />
            ))}
            <Chip
              label="すべて"
              active={filters.ranks.length === 0}
              activeClassName={ALL_CHIP_ACTIVE_CLASS}
              onClick={() => onChange({ ...filters, ranks: [] })}
            />
          </div>
        </div>
      )}

      <div>
        <span className="mb-1 block text-xs font-medium text-gray-500">
          訪問状況
        </span>
        <div className="flex flex-wrap gap-1.5">
          {VISITED_OPTIONS.map((opt) => (
            <Chip
              key={opt.value}
              label={opt.label}
              active={filters.visited.includes(opt.value)}
              activeClassName={ALL_CHIP_ACTIVE_CLASS}
              onClick={() =>
                onChange({
                  ...filters,
                  visited: toggleSelection(filters.visited, opt.value),
                })
              }
            />
          ))}
          <Chip
            label="すべて"
            active={filters.visited.length === 0}
            activeClassName={ALL_CHIP_ACTIVE_CLASS}
            onClick={() => onChange({ ...filters, visited: [] })}
          />
        </div>
      </div>
    </div>
  );
}
