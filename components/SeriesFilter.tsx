"use client";

import { useMemo, useState } from "react";

import type { Series } from "@/lib/types";
import { type SeriesStyleDefinition } from "@/lib/seriesStyle";
import { resolveSeriesChip } from "@/lib/spotStyle";
import SpotMarkGlyph from "@/components/SpotMarkGlyph";
import ChoiceRow, { toggleChoice } from "@/components/ChoiceRow";

/** シリーズの選択肢がこれを超える種別(放送回番号など)はボタン列を並べきれないため検索できる一覧にする */
export const SERIES_FILTER_BUTTONS_MAX = 12;

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

  // **選択中は青**(「すべて」と同じ)。シリーズの色で塗らないのは、
  // ランクを使う種別ではシリーズが色を持たないため —— 持たない種別だけ
  // 灰色や白で塗られると、選んだかどうかが読めないうえ意味も無い
  return (
    <ChoiceRow
      options={series.map((r) => {
        const { mark } = resolveSeriesChip(r, seriesStyles);
        return {
          value: r,
          title: r,
          // **絵の下にシリーズ名を添える。** アイコンだけでは何のシリーズか読めない
          // (丼の絵が3種類並ぶような種別では特に見分けが付かない)。
          // 中身が無いシリーズ(アイコンも文字も未設定)は名前だけを出す ——
          // チップは押す対象なので、空の四角では選べない。
          // **詰めて並べる`compact`は使わない** —— 名前を出すぶんの幅が要る
          // (`compact`はアイコン+左右の余白ぶんしかなく、名前が1文字ずつに潰れる)
          content:
            mark.kind === "none" ? (
              r
            ) : (
              <span className="flex flex-col items-center gap-0.5 leading-tight">
                <SpotMarkGlyph mark={mark} alt={r} className="h-4 w-4" />
                <span className="text-[10px]">{r}</span>
              </span>
            ),
        };
      })}
      selected={selected}
      onChange={onChange}
    />
  );
}

/**
 * 検索していないときに描く候補の件数。**一覧に内側のスクロールを作らない**ため、
 * 器の高さがそのまま伸びる —— 絞り込みモーダルの中で他の項目(訪問日など)が
 * 遠くなりすぎない件数に抑え、続きは「さらに表示」で出す
 */
const INITIAL_RESULT_LIMIT = 12;
/** 「さらに表示」後に一度に描く最大件数(数百件の種別で描画が重くならないようにする) */
const SEARCH_RESULT_LIMIT = 60;

/**
 * 選択肢が多い種別向けの、検索できるシリーズ絞り込み。
 * 選択中のシリーズをチップで出し、検索欄で絞った候補をタップでトグルする。
 *
 * **候補一覧に内側のスクロール領域(`max-h-* overflow-y-auto`)を持たせない。**
 * かつては高さを固定して中でスクロールさせていたが、実機のスマホ(Safari・Chromeとも)で
 * 選択中の行の青い背景が本来の位置からずれて描かれ、右端の✓が見えたり見えなかったり
 * した。入れ子のスクロール領域を指で慣性スクロールさせたときの描画で崩れるもので、
 * PCの開発者ツールのスマホ表示(ホイールでのスクロール)では再現しない。
 * ページ・モーダル側のスクロールに任せれば、この崩れも「一覧の上で指を動かすと
 * ページが動かない」スクロールの取り合いも起きない。
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
  // 「さらに表示」を押したか。検索語を変えても畳み直さない
  // (絞ってから広げ直す手間のほうが大きいため)
  const [expanded, setExpanded] = useState(false);
  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return series;
    return series.filter((r) => r.toLowerCase().includes(q));
  }, [series, query]);
  const shown = matched.slice(
    0,
    expanded ? SEARCH_RESULT_LIMIT : INITIAL_RESULT_LIMIT
  );
  const rest = matched.length - shown.length;

  return (
    // **器はoverflow-hidden**。選択中の行の青い背景は端まで塗るので、
    // 角丸で切らないと一覧の上下端で背景が枠の角からはみ出す
    <div className="overflow-hidden rounded-lg border border-gray-300 bg-white">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-gray-100 p-2">
          {/* 選択中のシリーズ。ボタン列と同じく**青で塗る**(シリーズの色は使わない) */}
          {selected.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onChange(selected.filter((v) => v !== r))}
              className="max-w-full truncate rounded-full bg-blue-600 px-2 py-1 text-xs font-medium text-white"
              title={`${r} を外す`}
            >
              {r} ✕
            </button>
          ))}
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-full px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
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
      <ul className="border-t border-gray-100">
        {shown.map((r) => {
          const { face } = resolveSeriesChip(r, seriesStyles);
          const active = selected.includes(r);
          return (
            <li key={r}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onChange(toggleChoice(selected, r))}
                className={`flex w-full items-center gap-2 px-2 py-2.5 text-left text-sm ${
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
                {/* ✓の場所は選んでいないときも空けておく —— 出し入れで文字の幅が
                    変わると、続けてタップしたときに行の中身が動いて読みにくい */}
                <span
                  aria-hidden
                  className={`shrink-0 text-blue-600 ${active ? "" : "invisible"}`}
                >
                  ✓
                </span>
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
      {rest > 0 &&
        (expanded ? (
          <p className="border-t border-gray-100 px-2 py-1.5 text-xs text-gray-500">
            ほか{rest}件。検索で絞り込んでください
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full border-t border-gray-100 px-2 py-2.5 text-xs font-medium text-blue-600"
          >
            さらに{Math.min(rest, SEARCH_RESULT_LIMIT - INITIAL_RESULT_LIMIT)}件を表示
          </button>
        ))}
    </div>
  );
}
