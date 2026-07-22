"use client";

import { useMemo } from "react";
import { distinctValues, type Category, type Series, type Spot } from "@/lib/types";
import { getSeriesOrder, type SeriesStyleDefinition } from "@/lib/seriesStyle";
import { getCategoryOrder } from "@/lib/category";
import SeriesFilter from "@/components/SeriesFilter";

export type VisitedValue = "visited" | "unvisited";

export interface SpotFilters {
  /** 空配列 = シリーズによる絞り込みなし(「すべて」選択中、全件表示) */
  series: Series[];
  /** 空配列 = カテゴリによる絞り込みなし(「すべて」選択中、全件表示) */
  categories: Category[];
  /** 空配列 = 訪問状況による絞り込みなし(「すべて」選択中、全件表示) */
  visited: VisitedValue[];
}

export const DEFAULT_FILTERS: SpotFilters = {
  series: [],
  categories: [],
  visited: [],
};

/**
 * フィルタを通過するか判定する(地図・リスト共通ロジック)。
 */
export function passesFilters(
  filters: SpotFilters,
  series: Series | null,
  categories: Category[],
  isVisited: boolean
): boolean {
  if (filters.series.length > 0) {
    if (series === null || !filters.series.includes(series)) return false;
  }
  // スポットは複数のカテゴリを持てるため、選択中のいずれかを持っていれば通す(OR条件)
  if (filters.categories.length > 0) {
    if (!categories.some((c) => filters.categories.includes(c))) return false;
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
  activeClassName?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 font-medium ${
        active
          ? activeClassName ?? "border-transparent"
          : "border-gray-300 bg-white text-gray-400"
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
  seriesStyles,
  categories,
}: {
  /** 現在アクティブなスポット種別の実データから、シリーズ・カテゴリの選択肢を動的に作る */
  spots: Spot[];
  filters: SpotFilters;
  onChange: (filters: SpotFilters) => void;
  /** このスポット種別のシリーズ設定(lib/useSeriesStyles.ts参照) */
  seriesStyles: SeriesStyleDefinition[];
  /** このスポット種別のカテゴリ設定(並び順に使う。lib/useCategories.ts参照) */
  categories: Category[];
}) {
  const availableSeries = useMemo(
    () =>
      distinctValues(spots.map((s) => s.series)).sort(
        (a, b) => getSeriesOrder(a, seriesStyles) - getSeriesOrder(b, seriesStyles)
      ),
    [spots, seriesStyles]
  );
  // 選択肢は実データに存在する値から作り、種別のカテゴリ設定の並び順に揃える
  // (設定に無い値はdistinctValuesの五十音順のまま末尾に出す)
  const availableCategories = useMemo(
    () =>
      distinctValues(spots.flatMap((s) => s.categories)).sort(
        (a, b) => getCategoryOrder(a, categories) - getCategoryOrder(b, categories)
      ),
    [spots, categories]
  );

  return (
    <div className="space-y-3 text-sm">
      {availableSeries.length > 1 && (
        <div>
          <span className="mb-1 block text-xs font-medium text-gray-500">
            シリーズ
          </span>
          <SeriesFilter
            series={availableSeries}
            selected={filters.series}
            onChange={(series) => onChange({ ...filters, series })}
            seriesStyles={seriesStyles}
          />
        </div>
      )}

      {availableCategories.length > 1 && (
        <div>
          <span className="mb-1 block text-xs font-medium text-gray-500">
            カテゴリ
          </span>
          <div className="flex flex-wrap gap-1.5">
            {availableCategories.map((category) => (
              <Chip
                key={category}
                label={category}
                active={filters.categories.includes(category)}
                activeClassName={ALL_CHIP_ACTIVE_CLASS}
                onClick={() =>
                  onChange({
                    ...filters,
                    categories: toggleSelection(filters.categories, category),
                  })
                }
              />
            ))}
            <Chip
              label="すべて"
              active={filters.categories.length === 0}
              activeClassName={ALL_CHIP_ACTIVE_CLASS}
              onClick={() => onChange({ ...filters, categories: [] })}
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
