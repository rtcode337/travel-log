"use client";

import { useMemo } from "react";
import { distinctValues, type Category, type Series, type Spot } from "@/lib/types";
import {
  getSeriesOrder,
  UNSET_SERIES,
  type SeriesStyleDefinition,
} from "@/lib/seriesStyle";
import { getCategoryOrder } from "@/lib/category";
import { NO_RANK, type Rank, type RankFilterValue } from "@/lib/rank";
import SeriesFilter from "@/components/SeriesFilter";
import RankFilter from "@/components/RankFilter";
import ChoiceRow from "@/components/ChoiceRow";
import HelpTip from "@/components/HelpTip";

export type VisitedValue = "visited" | "unvisited";

export interface SpotFilters {
  /**
   * 空配列 = ランクによる絞り込みなし(「すべて」選択中、全件表示)。
   * `'none'`(`NO_RANK`)はランクなしのスポットを指す。
   * ランクを使わない種別では選択肢を出さないので常に空
   */
  ranks: RankFilterValue[];
  /** 空配列 = シリーズによる絞り込みなし(「すべて」選択中、全件表示) */
  series: Series[];
  /** 空配列 = カテゴリによる絞り込みなし(「すべて」選択中、全件表示) */
  categories: Category[];
  /**
   * 訪問状況の絞り込み。既定は`["unvisited"]`(未訪問のみ)で、「すべて」チップは
   * 無い(両方選択=全件表示)。UI上は空選択を作れない(見た目が「何も表示しない」に
   * 見えるのに全件表示になるため)が、判定(`passesFilters`)は旧保存データ互換の
   * ため空配列=絞り込みなし(全件)としても動く
   */
  visited: VisitedValue[];
  /**
   * 訪問順の経路を描く対象日(`YYYY-MM-DD`のローカル日付)。絞り込みではなく、
   * 地図でその日に訪問したスポットを訪問順に矢印で結ぶための対象日。
   * null = 経路を表示しない。既定はその日(今日)。地図専用(一覧では使わない)。
   * **期間で指定するときは開始日**(終了日は`visitedDateTo`)。
   */
  visitedDate: string | null;
  /**
   * 訪問順の経路の対象期間の終了日(`YYYY-MM-DD`)。null = 単日(`visitedDate`のみ)。
   * **開始日と別の列にしてあるので、単日はこれまでどおり`visitedDate`だけで表せる**
   * —— 保存済みの条件(この項目が無い)もそのまま単日として読める。
   * 旅行のように複数日にまたがる訪問を1本の経路として辿るための指定。
   */
  visitedDateTo: string | null;
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
  /**
   * クラスタ(近くのピンを「N件」の丸にまとめる表示)を止めるか。既定はまとめる。
   * 絞り込みではなく表示の切り替えなので、リセットや「絞り込み中」の判定には
   * 入れない(`showRoutes`と同じ扱い)。地図専用
   */
  disableCluster: boolean;
  /**
   * 「これだけを表示」で1つの経路だけに絞っている状態。'visit'=訪問順の経路(訪問日)の
   * スポットだけ、'plan'=訪問予定リストのスポットだけを地図に表示し、他のスポット・
   * ルート・もう一方の経路は隠す。null=通常(絞り込みに従って表示)。地図専用の設定で、
   * 対象(visitedDate / planListId)が無いときは無視される
   */
  isolate: "visit" | "plan" | null;
}

export const DEFAULT_FILTERS: SpotFilters = {
  ranks: [],
  series: [],
  categories: [],
  visited: ["unvisited"],
  visitedDate: null,
  visitedDateTo: null,
  planListId: null,
  showRoutes: true,
  disableCluster: false,
  isolate: null,
};

/** 訪問状況が既定(未訪問のみ)のままか(絞り込み中とみなさない条件) */
export function isDefaultVisited(visited: VisitedValue[]): boolean {
  return visited.length === 1 && visited[0] === "unvisited";
}

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
  isVisited: boolean,
  /** ランク。使わない種別・渡されない呼び出しはランクなし扱い */
  rank: Rank | null = null
): boolean {
  if (filters.ranks.length > 0) {
    if (!filters.ranks.includes(rank ?? NO_RANK)) return false;
  }
  if (filters.series.length > 0) {
    // シリーズ未設定(null/空)は「未設定」として突き合わせる
    const effective = series && series.length > 0 ? series : UNSET_SERIES;
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
 * 何らかの絞り込みが掛かっているか=既定と違う絞り込み条件か(リセットボタンと
 * 地図の絞り込みボタンの見た目の条件)。訪問状況は既定が「未訪問のみ」のため、
 * 空ではなく既定と違うかどうかで見る。`showRoutes`は表示の切り替え、
 * `visitedDate`は訪問順の経路の対象日(絞り込みではない)であって、
 * どちらも絞り込みではないため含めない。
 */
export function hasActiveFilters(filters: SpotFilters): boolean {
  return (
    filters.ranks.length > 0 ||
    filters.series.length > 0 ||
    filters.categories.length > 0 ||
    !isDefaultVisited(filters.visited)
  );
}

/**
 * 絞り込み(シリーズ・カテゴリ・訪問状況)だけを既定に戻すボタン
 * (条件を1つずつ戻す手間を省く)。常に出しておき、戻す対象があるとき
 * (`hasActiveFilters`)だけチップと同じ青にして知らせる
 * (出し入れするとボタンの位置が動くため)。
 * 絞り込みではないもの(`showRoutes`・訪問日・訪問予定リスト・「これだけを表示」)は
 * 対象外で現在値を維持する(地図ではそれぞれのセクションの個別リセットで戻す)。
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
      onClick={() =>
        onChange({
          ...filters,
          ranks: [],
          series: [],
          categories: [],
          visited: [...DEFAULT_FILTERS.visited],
        })
      }
      className={`rounded-full border px-3 py-1 text-xs font-medium ${
        active ? ALL_CHIP_ACTIVE_CLASS : "border-gray-300 bg-white text-gray-400"
      }`}
    >
      リセット
    </button>
  );
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
  rankEnabled = false,
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
  /** その種別がランクを使うか。使うときだけランクのチップを出す(lib/useRankEnabled.ts) */
  rankEnabled?: boolean;
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
    // シリーズ未設定のスポットが1件でもあれば選択肢に加える
    // (自分が追加した非公開スポットもシリーズ絞り込みで選べるようにする)
    const hasUnset = spots.some((s) => !s.series);
    const base = hasUnset ? [...known, UNSET_SERIES] : known;
    // 選択中だが実データに無いシリーズ(最後の1件を削除した後など)も、
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

      {rankEnabled && (
        <div>
          <span className="mb-1 block text-xs font-medium text-gray-500">
            ランク
          </span>
          <RankFilter
            selected={filters.ranks}
            onChange={(ranks) => onChange({ ...filters, ranks })}
          />
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
          {/* シリーズ・ランク・訪問状況と同じ器。**カテゴリだけ折り返しを許す**
              —— 値が長く数も多い種別(飲食店の12個など)があり、1行に詰めると
              1つあたりの幅が足りずに文字が潰れる */}
          <ChoiceRow
            wrap
            options={availableCategories.map((category) => ({
              value: category,
              content: category,
            }))}
            selected={filters.categories}
            onChange={(categories) => onChange({ ...filters, categories })}
          />
        </div>
      )}

      <div>
        <span className="mb-1 block text-xs font-medium text-gray-500">
          訪問状況
        </span>
        {/* シリーズ・ランクと同じ扱い。「すべて」=空配列で、全部選んでも
            「すべて」には切り替わらない(既定は「未訪問」のみ) */}
        <ChoiceRow
          options={VISITED_OPTIONS.map((opt) => ({
            value: opt.value,
            content: opt.label,
          }))}
          selected={filters.visited}
          onChange={(visited) => onChange({ ...filters, visited })}
        />
      </div>

      {showRouteToggle && (
        <div className="border-t border-gray-100 pt-3">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-500">
            経路
            <HelpTip>
              オンにすると、巡った順の矢印(経路)を地図に表示します。シリーズ・カテゴリで絞り込み中は、該当する経路だけに絞られます。
            </HelpTip>
          </span>
          <div className="flex flex-wrap gap-1.5">
            <Chip
              label="経路を表示"
              active={filters.showRoutes}
              activeClassName={ALL_CHIP_ACTIVE_CLASS}
              onClick={() =>
                onChange({ ...filters, showRoutes: !filters.showRoutes })
              }
            />
          </div>
        </div>
      )}

    </div>
  );
}
