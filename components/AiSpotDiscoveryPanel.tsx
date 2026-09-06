"use client";

import { useEffect, useRef } from "react";
import {
  ALLOWED_STATUS_BY_ROLE,
  PREFECTURES,
  STATUS_LABELS,
  type Role,
  type SpotStatus,
} from "@/lib/types";
import { regionFieldLabel } from "@/lib/region";
import { RANKS, type Rank } from "@/lib/rank";
import type { DiscoveryCandidate, DiscoverySource } from "@/lib/spotDiscovery";

/**
 * 周辺のAI探索の結果を並べる、地図の右側のパネル(`PlanBuildPanel`と同じ置き方)。
 * 候補は地図に番号つきの印で描かれ、**行を押すとそのピンへ寄り、ピンを押すとその行が
 * 目立つ**(一覧の名前と地図の印を目で突き合わせなくて済むように)。
 *
 * できることは5つ: チェックで「追加するもの」を選ぶ、×で候補から外す、
 * **「位置を直す」でその1件だけ住所から座標を引き直す**、「もう一度探す」で別の検索語・
 * 別の探し方の候補を**同じ一覧に足す**、「追加」でチェック済みをまとめて登録する。
 *
 * **位置の引き直しは行ごと**にしてある。候補すべてに地名検索をかけると1件1秒の
 * 間隔制限がそのまま待ちになるが、気づいた1件だけなら1秒で済む
 * (AIの座標は当てにならないことがあり、地図で見て初めて分かる)。
 *
 * 状態・シリーズは全行共通(追加後に個別に編集できるので、ここでは行ごとに分けない)。
 * ランクだけはAIの提案値を行ごとに直せる。
 */
export interface DiscoveryRow {
  /** 一覧・地図の印で共有する通し番号(1始まり。外しても振り直さない) */
  no: number;
  candidate: DiscoveryCandidate;
  checked: boolean;
  rank: Rank | "";
  /** この候補を返した探索の日時(説明文の出どころ表示に使う) */
  searchedAt: string;
  /** どの探し方で見つかったか(行の印と、説明文の出どころに使う) */
  source: DiscoverySource;
  /** 「位置を直す」で住所から引き直したか(印を分けるため) */
  relocated?: boolean;
}

export default function AiSpotDiscoveryPanel({
  rows,
  role,
  regionScope,
  rankEnabled,
  seriesOptions,
  status,
  series,
  fallbackRegion,
  focusedNo,
  adding,
  error,
  onStatusChange,
  onSeriesChange,
  onFallbackRegionChange,
  onToggle,
  onRankChange,
  onRemove,
  onRelocate,
  relocatingNo,
  onFocus,
  onSearchAgain,
  onShowExchange,
  onAdd,
  onClose,
}: {
  rows: DiscoveryRow[];
  role: Role | null;
  regionScope: string;
  rankEnabled: boolean;
  /** 種別のシリーズ設定の値(定義順)。空なら選ばせず、シリーズなしで追加する */
  seriesOptions: string[];
  status: SpotStatus;
  series: string;
  /** 地域が解けなかった候補に使う既定 */
  fallbackRegion: string;
  focusedNo: number | null;
  adding: boolean;
  error: string | null;
  onStatusChange: (status: SpotStatus) => void;
  onSeriesChange: (series: string) => void;
  onFallbackRegionChange: (region: string) => void;
  onToggle: (no: number) => void;
  onRankChange: (no: number, rank: Rank | "") => void;
  onRemove: (no: number) => void;
  /** その候補の位置を住所から引き直す(1件だけなので待ちは1秒ほど) */
  onRelocate: (no: number) => void;
  /** いま引き直している行(ボタンを押せなくする) */
  relocatingNo: number | null;
  onFocus: (no: number) => void;
  onSearchAgain: () => void;
  /** 直近のAIとのやり取りを見る(AIで探していなければ渡さない) */
  onShowExchange?: () => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const allowedStatuses = (role ? ALLOWED_STATUS_BY_ROLE[role] : ["private"]).filter(
    (s) => s !== "private"
  ) as SpotStatus[];
  const checkedRows = rows.filter((r) => r.checked && !r.candidate.existing);
  const needsFallbackRegion = rows.some((r) => !r.candidate.region);
  const seriesRequired = seriesOptions.length > 0;

  // 地図の印を押したときに、その行が見える位置までスクロールする
  useEffect(() => {
    if (focusedNo == null) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-no="${focusedNo}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [focusedNo]);

  return (
    <div className="absolute bottom-0 right-0 top-40 z-20 flex w-2/5 max-w-sm flex-col overflow-hidden rounded-tl-xl bg-white/95 shadow-xl backdrop-blur">
      <div className="border-b border-gray-200 p-3">
        <p className="text-xs text-gray-500">この周辺を探す</p>
        <h2 className="font-bold leading-snug">候補 {rows.length}件(チェック {checkedRows.length}件)</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          行を押すと地図がそこへ寄ります。候補は保存されず、追加したものだけがスポットになります。
        </p>
      </div>

      <ul ref={listRef} className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto">
        {rows.length === 0 && (
          <li className="p-3 text-xs text-gray-500">
            候補がありません。「もう一度探す」から検索語・半径・探し方を変えて探せます。
          </li>
        )}
        {rows.map((row) => {
          const c = row.candidate;
          const disabled = !!c.existing;
          const focused = row.no === focusedNo;
          return (
            <li
              key={row.no}
              data-no={row.no}
              className={`flex items-start gap-2 py-2 pl-2 pr-2 ${
                focused ? "bg-blue-50 ring-1 ring-inset ring-blue-400" : ""
              } ${!c.url || disabled ? "opacity-60" : ""}`}
            >
              <input
                type="checkbox"
                checked={row.checked && !disabled}
                disabled={disabled}
                onChange={() => onToggle(row.no)}
                className="mt-1 shrink-0"
                aria-label="追加する"
              />
              <button
                type="button"
                onClick={() => onFocus(row.no)}
                className="min-w-0 flex-1 space-y-0.5 text-left"
                title={`${c.name}(タップで地図をここへ)`}
              >
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 px-1 text-xs font-bold text-white">
                    {row.no}
                  </span>
                  <span className={`text-sm leading-snug ${focused ? "font-medium text-blue-700" : ""}`}>
                    {c.name}
                  </span>
                  {c.genre && (
                    <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700">
                      {c.genre}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 text-[11px]">
                  {/* 出どころ。同じ一覧に地図データとAIの候補が混ざるので必ず出す */}
                  <span
                    className={`rounded px-1 py-0.5 ${
                      row.source === "osm"
                        ? "bg-sky-100 text-sky-800"
                        : "bg-violet-100 text-violet-800"
                    }`}
                  >
                    {row.source === "osm" ? "地図データ" : "AI"}
                  </span>
                  {c.existing ? (
                    <span className="rounded bg-gray-200 px-1 py-0.5 text-gray-700">
                      登録済み: {c.existing.name}
                    </span>
                  ) : row.relocated ? (
                    <span className="rounded bg-green-100 px-1 py-0.5 text-green-800">住所から取得</span>
                  ) : row.source === "ai" && !c.location_verified ? (
                    <span className="rounded bg-amber-100 px-1 py-0.5 text-amber-800">位置未確認</span>
                  ) : null}
                  <span className="rounded bg-gray-100 px-1 py-0.5 text-gray-600">
                    {c.distance_m >= 1000 ? `${(c.distance_m / 1000).toFixed(1)} km` : `${c.distance_m} m`}
                  </span>
                  {/* 参照URLはAIの候補の根拠。地図データには元から無いので責めない */}
                  {row.source === "ai" && !c.url && (
                    <span className="rounded bg-red-50 px-1 py-0.5 text-red-700">参照URLなし</span>
                  )}
                </div>
                {c.summary && <p className="text-xs leading-snug text-gray-700">{c.summary}</p>}
              </button>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <button
                  type="button"
                  aria-label="候補から外す"
                  onClick={() => onRemove(row.no)}
                  className="px-1 text-lg leading-none text-gray-400 hover:text-red-500"
                >
                  ×
                </button>
                {rankEnabled && (
                  <select
                    value={row.rank}
                    disabled={disabled}
                    onChange={(e) => onRankChange(row.no, e.target.value as Rank | "")}
                    title={c.rank_reason ?? "ランク"}
                    className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                  >
                    <option value="">なし</option>
                    {RANKS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                )}
                {/* 位置がずれていると思ったときに、その1件だけ住所から引き直す。
                    AIの座標は当てにならないことがあるので、気づいた行だけ直せればよい */}
                {c.address && (
                  <button
                    type="button"
                    onClick={() => onRelocate(row.no)}
                    disabled={relocatingNo === row.no}
                    title={`「${c.address}」から位置を引き直す`}
                    className="text-[11px] text-blue-600 underline disabled:opacity-50"
                  >
                    {relocatingNo === row.no ? "取得中…" : "位置を直す"}
                  </button>
                )}
                {c.url && (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-blue-600 underline"
                  >
                    参照
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 border-t border-gray-200 p-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-0.5 block text-[11px] font-medium text-gray-600">状態</label>
            <select
              value={status}
              onChange={(e) => onStatusChange(e.target.value as SpotStatus)}
              className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm"
            >
              {allowedStatuses.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          {seriesRequired && (
            <div>
              <label className="mb-0.5 block text-[11px] font-medium text-gray-600">シリーズ *</label>
              <select
                value={series}
                onChange={(e) => onSeriesChange(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm"
              >
                {seriesOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* 地域が取れなかった候補があるときだけ、全行共通の既定を選ばせる */}
          {needsFallbackRegion && (
            <div className="col-span-2">
              <label className="mb-0.5 block text-[11px] font-medium text-gray-600">
                {regionFieldLabel(regionScope)}(地域が分からなかった候補に使う) *
              </label>
              {regionScope === "jp" ? (
                <select
                  value={fallbackRegion}
                  onChange={(e) => onFallbackRegionChange(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm"
                >
                  <option value="">選択</option>
                  {PREFECTURES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={fallbackRegion}
                  onChange={(e) => onFallbackRegionChange(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm"
                />
              )}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          type="button"
          onClick={onAdd}
          disabled={adding || checkedRows.length === 0}
          className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {adding ? "追加中…" : `${checkedRows.length}件を${STATUS_LABELS[status]}で追加`}
        </button>
        {/* 直近がAIだったときだけ。何を頼んで何が返ったかを見ないと、
            遅い・少ない・的外れの原因を切り分けられない */}
        {onShowExchange && (
          <button
            type="button"
            onClick={onShowExchange}
            disabled={adding}
            className="w-full rounded-lg border border-gray-200 py-1.5 text-xs text-gray-600 disabled:opacity-50"
          >
            AIとのやり取りを見る
          </button>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSearchAgain}
            disabled={adding}
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-600 disabled:opacity-50"
          >
            もう一度探す
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={adding}
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-600 disabled:opacity-50"
          >
            終了
          </button>
        </div>
      </div>
    </div>
  );
}
