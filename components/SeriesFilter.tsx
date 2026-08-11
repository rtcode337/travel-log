"use client";

import { useMemo, useState } from "react";

import type { Series } from "@/lib/types";
import { type SeriesStyleDefinition } from "@/lib/seriesStyle";
import { resolveSeriesChip } from "@/lib/spotStyle";
import SpotMarkGlyph from "@/components/SpotMarkGlyph";

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

  // ボタンを並べきれない種別(放送回番号・作品名など)は、検索できる一覧にする。
  // かつては単一選択のプルダウンだったが、アニメ聖地のようにシリーズが数百ある
  // 種別では目当ての値を探せず、複数選択もできなかった
  if (series.length > SERIES_FILTER_BUTTONS_MAX) {
    return (
      <SearchableSeriesFilter
        series={series}
        selected={selected}
        onChange={onChange}
        seriesStyles={seriesStyles}
      />
    );
  }

  return (
    <div className="flex divide-x divide-gray-300 overflow-hidden rounded-l-lg border border-gray-300 bg-white text-sm">
      <button
        type="button"
        onClick={() => onChange([])}
        // 角丸は左端だけ(枠も rounded-l-lg)。**右端は直角**にする ——
        // 枠が角丸だと overflow-hidden が最後のチップの角を丸く切ってしまい、
        // そこだけ形が違って見えるため
        className={`flex-1 rounded-l-lg px-2 py-1.5 font-medium ${
          selected.length === 0
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
        }`}
      >
        すべて
      </button>
      {series.map((r) => {
        const { face, mark } = resolveSeriesChip(r, seriesStyles);
        const active = selected.includes(r);
        return (
          <button
            key={r}
            type="button"
            title={r}
            onClick={() => onChange(toggleSelection(selected, r))}
            // 選択中はそのシリーズの色で塗る。**未選択側を灰色にしてある**のは、
            // 白いシリーズ(シリーズ未設定)だと塗っても地の白と同じで、
            // 選んだかどうかが分からなくなるため。あわせて選択中は下辺に
            // 縁取り色の帯を敷き、白でも選択が分かるようにする
            // (**四辺を囲むリングにはしない** —— 1つ1つが独立した四角の箱に
            //  見えて、ひと続きの切り替えとして読めなくなる)
            style={
              active
                ? {
                    backgroundColor: face.color,
                    color: face.textColor,
                    boxShadow: `inset 0 -3px 0 ${face.borderColor}`,
                  }
                : undefined
            }
            className={`flex-1 px-2 py-1.5 font-medium ${
              active ? "" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {/* 中身が無いシリーズ(アイコンも文字も未設定)はシリーズ名をそのまま出す
                —— チップは押す対象なので、空の四角では選べない */}
            <SpotMarkGlyph mark={mark} alt={r} className="mx-auto h-4 w-4" />
            {mark.kind === "none" && r}
          </button>
        );
      })}
    </div>
  );
}

/** 一覧に一度に描く最大件数(数百件の種別で描画が重くならないようにする) */
const SEARCH_RESULT_LIMIT = 60;

/**
 * 選択肢が多い種別向けの、検索できるシリーズ絞り込み。
 * 選択中のシリーズをチップで出し、検索欄で絞った候補をタップでトグルする。
 */
function SearchableSeriesFilter({
  series,
  selected,
  onChange,
  seriesStyles,
}: {
  series: Series[];
  selected: Series[];
  onChange: (series: Series[]) => void;
  seriesStyles: SeriesStyleDefinition[];
}) {
  const [query, setQuery] = useState("");
  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return series;
    return series.filter((r) => r.toLowerCase().includes(q));
  }, [series, query]);
  const shown = matched.slice(0, SEARCH_RESULT_LIMIT);

  return (
    <div className="rounded-lg border border-gray-300 bg-white">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-gray-100 p-2">
          {selected.map((r) => {
            const { face } = resolveSeriesChip(r, seriesStyles);
            return (
              <button
                key={r}
                type="button"
                onClick={() => onChange(selected.filter((v) => v !== r))}
                style={{ backgroundColor: face.color, color: face.textColor }}
                className="max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium"
                title={`${r} を外す`}
              >
                {r} ✕
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-full px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100"
          >
            すべて解除
          </button>
        </div>
      )}
      <div className="p-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`シリーズを検索(${series.length}件)`}
          autoComplete="off"
          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
        />
      </div>
      <ul className="max-h-56 overflow-y-auto border-t border-gray-100">
        {shown.map((r) => {
          const { face } = resolveSeriesChip(r, seriesStyles);
          const active = selected.includes(r);
          return (
            <li key={r}>
              <button
                type="button"
                onClick={() => onChange(toggleSelection(selected, r))}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${
                  active ? "bg-blue-50 font-medium" : "hover:bg-gray-50"
                }`}
              >
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-full border"
                  style={{
                    backgroundColor: face.color,
                    borderColor: face.borderColor,
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{r}</span>
                {active && <span className="shrink-0 text-blue-600">✓</span>}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="px-2 py-3 text-center text-sm text-gray-500">
            該当するシリーズがありません
          </li>
        )}
      </ul>
      {matched.length > shown.length && (
        <p className="border-t border-gray-100 px-2 py-1.5 text-xs text-gray-500">
          ほか{matched.length - shown.length}件。検索で絞り込んでください
        </p>
      )}
    </div>
  );
}
