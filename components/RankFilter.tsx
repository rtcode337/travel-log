"use client";

import type { Rank } from "@/lib/types";
import { autoTextColor, findRankStyle, type RankStyleDefinition } from "@/lib/rankStyle";

/** ランクの選択肢がこれを超える種別(放送回番号など)はボタン列を並べきれないためselectにする */
export const RANK_FILTER_BUTTONS_MAX = 12;

/**
 * 「すべて」(空配列)の状態から特定の1件を選ぶと、それ単独の絞り込みになる
 * (他をすべて手で外す手間を省くため)。それ以外は通常のトグル(追加/除外)。
 */
function toggleSelection(current: Rank[], clicked: Rank): Rank[] {
  if (current.length === 0) return [clicked];
  return current.includes(clicked)
    ? current.filter((v) => v !== clicked)
    : [...current, clicked];
}

/**
 * ランクによる複数選択の絞り込みUI。地図・一覧の絞り込み(FilterBar)と
 * 「ランクから探す」タブ(SpotsView)の両方で共通の見た目・挙動にするための部品。
 */
export default function RankFilter({
  ranks,
  selected,
  onChange,
  rankStyles,
}: {
  /** 選択肢(このスポット種別のランク設定の並び順に揃えて渡す) */
  ranks: Rank[];
  /** 空配列 = 絞り込みなし(「すべて」選択中) */
  selected: Rank[];
  onChange: (ranks: Rank[]) => void;
  rankStyles: RankStyleDefinition[];
}) {
  if (ranks.length === 0) return null;

  if (ranks.length > RANK_FILTER_BUTTONS_MAX) {
    return (
      <select
        multiple
        value={selected}
        onChange={(e) =>
          onChange(Array.from(e.target.selectedOptions, (o) => o.value as Rank))
        }
        size={Math.min(ranks.length, 6)}
        className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
      >
        {ranks.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white text-sm">
      {ranks.map((r) => {
        const style = findRankStyle(r, rankStyles);
        const active = selected.includes(r);
        return (
          <button
            key={r}
            type="button"
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
            {r}
          </button>
        );
      })}
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
    </div>
  );
}
