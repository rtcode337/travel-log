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
  /**
   * 訪問日(`YYYY-MM-DD`のローカル日付)。その日に訪問したスポットだけを表示する。
   * null = 訪問日による絞り込みなし。選べるのは自分の訪問記録がある日のみ
   */
  visitedDate: string | null;
}

export const DEFAULT_FILTERS: SpotFilters = {
  series: [],
  categories: [],
  visited: [],
  visitedDate: null,
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
 * `visitedDates`はそのスポットを訪問した日(`toVisitDateKey`のローカル日付。
 * 日時不明の訪問は含めない)で、訪問日の絞り込みを使う場合のみ渡す。
 */
export function passesFilters(
  filters: SpotFilters,
  series: Series | null,
  categories: Category[],
  isVisited: boolean,
  visitedDates: string[] = []
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
  // 訪問日で絞り込むときは、その日の訪問が1件でもあるスポットだけを通す
  // (=訪問日時が不明な訪問しかないスポット・未訪問のスポットは外れる)
  if (filters.visitedDate) {
    if (!visitedDates.includes(filters.visitedDate)) return false;
  }
  return true;
}

/** 何らかの絞り込みが掛かっているか(リセットボタンの表示条件) */
export function hasActiveFilters(filters: SpotFilters): boolean {
  return (
    filters.series.length > 0 ||
    filters.categories.length > 0 ||
    filters.visited.length > 0 ||
    filters.visitedDate !== null
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
      onClick={() => onChange(DEFAULT_FILTERS)}
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
  visitDates,
  showReset = true,
}: {
  /** 現在アクティブなスポット種別の実データから、シリーズ・カテゴリの選択肢を動的に作る */
  spots: Spot[];
  filters: SpotFilters;
  onChange: (filters: SpotFilters) => void;
  /**
   * 訪問日の選択肢(`YYYY-MM-DD`のローカル日付、新しい順)。呼び出し側が
   * 自分の訪問記録から作る。空なら訪問日の欄自体を出さない
   */
  visitDates: string[];
  /** このスポット種別のシリーズ設定(lib/useSeriesStyles.ts参照) */
  seriesStyles: SeriesStyleDefinition[];
  /** このスポット種別のカテゴリ設定(並び順に使う。lib/useCategories.ts参照) */
  categories: Category[];
  /** falseにすると内蔵のリセットボタンを出さない(呼び出し側で別の場所に置く場合) */
  showReset?: boolean;
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
  // 選択中の日が選択肢に無い場合(訪問記録を消した後など、保存済みの絞り込み条件を
  // 復元したとき)も、選択中の日を残して「指定なし」に戻せるようにする
  const visitDateOptions = useMemo(
    () =>
      filters.visitedDate && !visitDates.includes(filters.visitedDate)
        ? [filters.visitedDate, ...visitDates].sort((a, b) => b.localeCompare(a))
        : visitDates,
    [visitDates, filters.visitedDate]
  );
  const availableCategories = useMemo(
    () =>
      distinctValues(spots.flatMap((s) => s.categories)).sort(
        (a, b) => getCategoryOrder(a, categories) - getCategoryOrder(b, categories)
      ),
    [spots, categories]
  );

  return (
    <div className="space-y-3 text-sm">
      {showReset && (
        <div className="flex justify-end">
          <FilterResetButton filters={filters} onChange={onChange} />
        </div>
      )}

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

      {visitDateOptions.length > 0 && (
        <div>
          <span className="mb-1 block text-xs font-medium text-gray-500">
            訪問日
          </span>
          <select
            aria-label="訪問日"
            value={filters.visitedDate ?? ""}
            onChange={(e) =>
              onChange({ ...filters, visitedDate: e.target.value || null })
            }
            className={`w-full rounded-lg border bg-white px-2 py-1.5 ${
              // 絞り込み中は枠だけ青く・太くする(地図の絞り込みボタンと同じ合図。
              // 背景まで青くすると選択中の日付が読みにくいため枠のみ)。
              // border-widthではなくringで太らせるのは、幅の変化で高さがずれないようにするため
              filters.visitedDate
                ? "border-blue-600 ring-1 ring-blue-600"
                : "border-gray-300"
            }`}
          >
            <option value="">指定なし</option>
            {visitDateOptions.map((date) => (
              <option key={date} value={date}>
                {formatVisitDate(date)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            日を選ぶと、その日に訪問したスポットだけを表示し、地図では訪問した順に矢印で結びます。
          </p>
        </div>
      )}
    </div>
  );
}
