"use client";

import type { Series } from "@/lib/types";
import {
  autoTextColor,
  findSeriesStyle,
  isImageLabel,
  type SeriesStyleDefinition,
} from "@/lib/seriesStyle";

/** シリーズの選択肢がこれを超える種別(放送回番号など)はボタン列を並べきれないためselectにする */
export const SERIES_FILTER_BUTTONS_MAX = 12;

/**
 * 「すべて」(空配列)の状態から特定の1件を選ぶと、それ単独の絞り込みになる
 * (他をすべて手で外す手間を省くため)。それ以外は通常のトグル(追加/除外)。
 */
function toggleSelection(current: Series[], clicked: Series): Series[] {
  if (current.length === 0) return [clicked];
  return current.includes(clicked)
    ? current.filter((v) => v !== clicked)
    : [...current, clicked];
}

/**
 * シリーズによる複数選択の絞り込みUI。地図・一覧の絞り込み(FilterBar)と
 * 「シリーズから探す」タブ(SpotsView)の両方で共通の見た目・挙動にするための部品。
 */
export default function SeriesFilter({
  series,
  selected,
  onChange,
  seriesStyles,
}: {
  /** 選択肢(このスポット種別のシリーズ設定の並び順に揃えて渡す) */
  series: Series[];
  /** 空配列 = 絞り込みなし(「すべて」選択中) */
  selected: Series[];
  onChange: (series: Series[]) => void;
  seriesStyles: SeriesStyleDefinition[];
}) {
  if (series.length === 0) return null;

  // selectになるほど選択肢が多い種別(放送回番号等)では、HTMLの複数選択リスト
  // (ctrl/cmdクリックが要る・常に数行分の高さを取る)より、見慣れた単一選択の
  // プルダウンの方が使いやすいため、この場合だけ単一選択にする。横幅に余裕がある
  // ため、labelではなくseriesそのもの(短い略称ではなく完全な値)を選択肢に出す
  if (series.length > SERIES_FILTER_BUTTONS_MAX) {
    const ALL_VALUE = "";
    return (
      <select
        value={selected.length === 1 ? selected[0] : ALL_VALUE}
        onChange={(e) =>
          onChange(e.target.value === ALL_VALUE ? [] : [e.target.value as Series])
        }
        className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
      >
        <option value={ALL_VALUE}>すべて</option>
        {series.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white text-sm">
      <button
        type="button"
        onClick={() => onChange([])}
        className={`flex-1 px-2 py-1.5 font-medium ${
          selected.length === 0
            ? "bg-blue-600 text-white"
            : "text-gray-500 hover:bg-gray-50"
        }`}
      >
        すべて
      </button>
      {series.map((r) => {
        const style = findSeriesStyle(r, seriesStyles);
        const active = selected.includes(r);
        return (
          <button
            key={r}
            type="button"
            title={r}
            onClick={() => onChange(toggleSelection(selected, r))}
            style={
              active
                ? {
                    backgroundColor: style.color,
                    color: style.textColor ?? autoTextColor(style.color),
                  }
                : undefined
            }
            className={`flex-1 px-2 py-1.5 font-medium ${
              active ? "" : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            {isImageLabel(style.label) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={style.label.image}
                alt={r}
                className="mx-auto h-4 w-4 object-contain"
              />
            ) : (
              style.label
            )}
          </button>
        );
      })}
    </div>
  );
}
