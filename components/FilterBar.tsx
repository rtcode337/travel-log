"use client";

import { useMemo } from "react";
import { distinctValues, type Category, type Series, type Spot } from "@/lib/types";
import {
  getSeriesOrder,
  MY_SPOT_SERIES,
  type SeriesStyleDefinition,
} from "@/lib/seriesStyle";
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
  /**
   * 訪問順の経路を描く対象日(`YYYY-MM-DD`のローカル日付)。絞り込みではなく、
   * 地図でその日に訪問したスポットを訪問順に矢印で結ぶための対象日。
   * null = 経路を表示しない。既定はその日(今日)。地図専用(一覧では使わない)。
   */
  visitedDate: string | null;
  /**
   * 訪問予定リスト(旅程)の経路を描く対象リストのID。絞り込みではなく、
   * 訪問日と同様に、そのリストのスポットをリスト順に矢印で結ぶための対象。
   * null = 表示しない。地図専用(一覧では使わない)。
   */
  planListId: string | null;
  /**
   * ルート(巡った順の矢印)を地図に表示するか(既定オン)。オンならシリーズ・
   * カテゴリの絞り込みが無くても全ルートを表示し、絞り込み中はそれに連動して
   * 絞られる(`MapView`の`filterVisibleRoutes`)。地図専用の設定だがスポット一覧と
   * 型を共用しているため、一覧側では単に使われないだけ
   */
  showRoutes: boolean;
}

export const DEFAULT_FILTERS: SpotFilters = {
  series: [],
  categories: [],
  visited: [],
  visitedDate: null,
  planListId: null,
  showRoutes: true,
};

/**
 * 訪問日時(`visits.visited_on`のISO文字列)を絞り込み・選択肢のキーに使う
 * ローカル日付(`YYYY-MM-DD`)にする。日時不明(null)・不正値は`null`。
 * UTCのまま切ると日本時間の朝9時未満が前日になってしまうため、必ずローカルで切る
 */
export function toVisitDateKey(visitedOn: string | null): string | null {
  if (!visitedOn) return null;
  const d = new Date(visitedOn);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ドロップダウンに出す訪問日の表記(`2026-07-22` → `2026年7月22日(水)`) */
export function formatVisitDate(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${weekday})`;
}

/**
 * フィルタを通過するか判定する(地図・リスト共通ロジック)。
 * `visitedDate`は絞り込みではなく地図の「訪問順の経路」表示専用になったため、
 * ここでは扱わない(シリーズ・カテゴリ・訪問状況の3つだけを見る)。
 */
export function passesFilters(
  filters: SpotFilters,
  series: Series | null,
  categories: Category[],
  isVisited: boolean
): boolean {
  if (filters.series.length > 0) {
    // シリーズ未設定(null/空)は「マイスポット」として突き合わせる
    const effective = series && series.length > 0 ? series : MY_SPOT_SERIES;
    if (!filters.series.includes(effective)) return false;
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
 * 何らかの絞り込みが掛かっているか(リセットボタンと地図の絞り込みボタンの
 * 見た目の条件)。`showRoutes`は表示の切り替え、`visitedDate`は訪問順の経路の
 * 対象日(絞り込みではない)であって、どちらも絞り込みではないため含めない。
 */
export function hasActiveFilters(filters: SpotFilters): boolean {
  return (
    filters.series.length > 0 ||
    filters.categories.length > 0 ||
    filters.visited.length > 0
  );
}

/**
 * 全条件を「すべて」に戻すボタン(条件を1つずつ戻す手間を省く)。常に出しておき、
 * 戻す対象があるとき(`hasActiveFilters`)だけチップと同じ青にして知らせる
 * (出し入れするとボタンの位置が動くため)。
 * 置き場所が呼び出し側で異なる(地図は絞り込みモーダルの見出し行、
 * スポット一覧は`FilterBar`の先頭)ため、`FilterBar`から切り出してある
 */
export function FilterResetButton({
  filters,
  onChange,
}: {
  filters: SpotFilters;
  onChange: (filters: SpotFilters) => void;
}) {
  const active = hasActiveFilters(filters);
  return (
    <button
      type="button"
      disabled={!active}
      // showRoutesは絞り込みではないためリセットの対象外(現在の値を維持する)
      onClick={() => onChange({ ...DEFAULT_FILTERS, showRoutes: filters.showRoutes })}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${
        active ? ALL_CHIP_ACTIVE_CLASS : "border-gray-300 bg-white text-gray-400"
      }`}
    >
      リセット
    </button>
  );
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
  showReset = true,
  showRouteToggle = false,
}: {
  /** 現在アクティブなスポット種別の実データから、シリーズ・カテゴリの選択肢を動的に作る */
  spots: Spot[];
  filters: SpotFilters;
  onChange: (filters: SpotFilters) => void;
  /** このスポット種別のシリーズ設定(lib/useSeriesStyles.ts参照) */
  seriesStyles: SeriesStyleDefinition[];
  /** このスポット種別のカテゴリ設定(並び順に使う。lib/useCategories.ts参照) */
  categories: Category[];
  /** falseにすると内蔵のリセットボタンを出さない(呼び出し側で別の場所に置く場合) */
  showReset?: boolean;
  /**
   * ルート表示のオン/オフトグルを出す(地図で、かつルートのある種別のみ。
   * スポット一覧はルートを描かないため出さない)
   */
  showRouteToggle?: boolean;
}) {
  const availableSeries = useMemo(() => {
    const known = distinctValues(spots.map((s) => s.series)).sort(
      (a, b) => getSeriesOrder(a, seriesStyles) - getSeriesOrder(b, seriesStyles)
    );
    // シリーズ未設定(=マイスポット)のスポットが1件でもあれば選択肢に加える
    // (自分が追加した非公開のマイスポットもシリーズ絞り込みで選べるようにする)
    const hasMySpot = spots.some((s) => !s.series);
    const base = hasMySpot ? [...known, MY_SPOT_SERIES] : known;
    // 選択中だが実データに無いシリーズ(唯一のマイスポットを削除した後など)も、
    // 「すべて」に戻せるよう選択肢として残す(でないとチップごと消えて外せなくなる)
    const orphaned = filters.series.filter((s) => !base.includes(s));
    return [...base, ...orphaned];
  }, [spots, seriesStyles, filters.series]);
  // 選択肢は実データに存在する値から作り、種別のカテゴリ設定の並び順に揃える
  // (設定に無い値はdistinctValuesの五十音順のまま末尾に出す)。シリーズと同様、
  // 選択中だが実データに無いカテゴリも外せるよう選択肢として残す
  const availableCategories = useMemo(() => {
    const known = distinctValues(spots.flatMap((s) => s.categories)).sort(
      (a, b) => getCategoryOrder(a, categories) - getCategoryOrder(b, categories)
    );
    const orphaned = filters.categories.filter((c) => !known.includes(c));
    return [...known, ...orphaned];
  }, [spots, categories, filters.categories]);

  return (
    <div className="space-y-3 text-sm">
      {showReset && (
        <div className="flex justify-end">
          <FilterResetButton filters={filters} onChange={onChange} />
        </div>
      )}

      {(availableSeries.length > 1 || filters.series.length > 0) && (
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

      {(availableCategories.length > 1 || filters.categories.length > 0) && (
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

      {showRouteToggle && (
        <div>
          <span className="mb-1 block text-xs font-medium text-gray-500">
            ルート
          </span>
          <div className="flex flex-wrap gap-1.5">
            <Chip
              label="ルートを表示"
              active={filters.showRoutes}
              activeClassName={ALL_CHIP_ACTIVE_CLASS}
              onClick={() =>
                onChange({ ...filters, showRoutes: !filters.showRoutes })
              }
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            オンにすると、巡った順の矢印(ルート)を地図に表示します。シリーズ・カテゴリで絞り込み中は、該当するルートだけに絞られます。
          </p>
        </div>
      )}

    </div>
  );
}
