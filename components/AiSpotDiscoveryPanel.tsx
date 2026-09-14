"use client";

import { useEffect, useId, useRef } from "react";
import {
  ALLOWED_STATUS_BY_ROLE,
  PREFECTURES,
  STATUS_LABELS,
  type Role,
  type SpotStatus,
} from "@/lib/types";
import { regionFieldLabel } from "@/lib/region";
import { RANKS, type Rank } from "@/lib/rank";
import {
  DISCOVERY_SOURCE_LABELS,
  type DiscoveryCandidate,
  type DiscoverySource,
} from "@/lib/spotDiscovery";
import type { CollectCoverage } from "@/lib/spotCollect";
import { buildGoogleMapsCompareUrl } from "@/lib/googleMaps";

/**
 * 周辺の探索の結果を並べる、地図の右側のパネル(`PlanBuildPanel`と同じ置き方)。
 * 候補は地図に番号つきの印で描かれ、**行を押すとそのピンへ寄り、ピンを押すとその行が
 * 目立つ**(一覧の名前と地図の印を目で突き合わせなくて済むように)。
 *
 * **AIに精査させたときは、選ばれた行にチェックと「AIが選定」の印が付く**
 * (選ばれなかった行はチェックが外れて薄くなるが、消えはしない —— AIも見落とすので、
 * 選び直せる形で残す)。ジャンル・ランク・一言もそこで付く。
 *
 * できることは6つ: チェック(と見出しの「すべて選ぶ」)で「追加するもの」を選ぶ、
 * ×で候補から外す、
 * **「位置を直す」でその1件だけ住所から座標を引き直す**、「もう一度探す」で別の検索語・
 * 別の探し方の候補を**同じ一覧に足す**、「追加」でチェック済みをまとめて登録する。
 *
 * **位置の引き直しは行ごと**にしてある。候補すべてに地名検索をかけると1件1秒の
 * 間隔制限がそのまま待ちになるが、気づいた1件だけなら1秒で済む
 * (AIの座標は当てにならないことがあり、地図で見て初めて分かる)。
 *
 * 状態は全行共通(追加後に個別に編集できるので、ここでは行ごとに分けない)。
 * **シリーズとランクは行ごと**にAI・地図データの値を直せる。
 *
 * **候補のジャンルはシリーズに入れる。** シリーズはピンの中身と色を決める軸なので、
 * ここに入れて初めて**地図で何を追加したのかが見分けられる**(カテゴリは絞り込み専用で
 * 見た目には効かない。`lib/spotStyle.ts`)。一覧に無いジャンルは追加時に種別の
 * シリーズ設定へ自動で足されるので、行ごとに選び直す必要はない。
 *
 * **カテゴリは一括だけ**(「この一帯はラーメン」のようなまとめの札)。
 * 候補ごとの分類はシリーズが受け持つので、行ごとの欄は置かない。
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
  /**
   * AIの精査が当たったか(地図データの行だけ)。**「AIが見て選ばなかった」と
   * 「AIに渡していない」は別物**なので、未設定と`dropped`を分ける ——
   * 地図データは近い順に上限まで渡すので、渡していない行のほうが多い
   */
  reviewed?: "picked" | "dropped";
  /** この候補を頼んだときの半径(m)。**行ごとに持つ** —— 「もう一度探す」で
      別の半径の結果が同じ一覧に混ざるため、画面側の今の値では判定できない */
  radius: number;
  /**
   * 追加するときに付けるシリーズ。**未設定(`undefined`)なら候補のジャンルを使う** ——
   * 手で直したときだけ値を持つので、AIの精査でジャンルが付け直されても
   * 直した内容が消えない(逆に、直していない行はAIの結果に追従する)
   */
  series?: string;
}

/** その行が追加時に持つシリーズ(手で直していなければ候補のジャンル) */
export function discoveryRowSeries(row: DiscoveryRow): string {
  return row.series ?? row.candidate.genre ?? "";
}

export default function AiSpotDiscoveryPanel({
  ref,
  rows,
  role,
  regionScope,
  rankEnabled,
  seriesOptions,
  status,
  category,
  categoryOptions,
  fallbackRegion,
  focusedNo,
  adding,
  error,
  onStatusChange,
  onCategoryChange,
  onFallbackRegionChange,
  onToggle,
  onToggleAll,
  onRankChange,
  onRowSeriesChange,
  onRemove,
  onRelocate,
  relocatingNo,
  onFocus,
  onSearchAgain,
  onShowExchange,
  coverage,
  onCollectMissing,
  collectStarting,
  aiPending,
  onAdd,
  onClose,
}: {
  rows: DiscoveryRow[];
  role: Role | null;
  regionScope: string;
  rankEnabled: boolean;
  /** 種別のシリーズ設定の値(定義順)。行ごとのシリーズ欄の候補に出す */
  seriesOptions: string[];
  status: SpotStatus;
  /** 追加する全件に足すカテゴリ(空なら足さない) */
  category: string;
  /** カテゴリ欄の候補(種別の設定+既存の値) */
  categoryOptions: string[];
  /** 地域が解けなかった候補に使う既定 */
  fallbackRegion: string;
  focusedNo: number | null;
  adding: boolean;
  error: string | null;
  onStatusChange: (status: SpotStatus) => void;
  onCategoryChange: (category: string) => void;
  onFallbackRegionChange: (region: string) => void;
  onToggle: (no: number) => void;
  /** 追加できる行をまとめて選ぶ・まとめて外す(登録済みの行は対象外) */
  onToggleAll: (checked: boolean) => void;
  onRankChange: (no: number, rank: Rank | "") => void;
  /** その行だけシリーズを直す(地図データのジャンルが実態と合わないことがあるため) */
  onRowSeriesChange: (no: number, series: string) => void;
  onRemove: (no: number) => void;
  /** その候補の位置を住所から引き直す(1件だけなので待ちは1秒ほど) */
  onRelocate: (no: number) => void;
  /** いま引き直している行(ボタンを押せなくする) */
  relocatingNo: number | null;
  onFocus: (no: number) => void;
  onSearchAgain: () => void;
  /** 直近のAIとのやり取りを見る(AIに聞いていなければ渡さない) */
  onShowExchange?: () => void;
  /**
   * 円の中がどこまで収集済みか(「この周辺の集めた情報」で開いたときだけ)。
   * **集まっているぶんは出したうえで、足りない範囲を言う** —— 何も出ないのと
   * 「まだ集めていない範囲がある」のとでは、次にすることが違う
   */
  coverage?: CollectCoverage | null;
  /** まだ回っていない地域を、予定を待たずに集めさせる */
  onCollectMissing?: () => void;
  collectStarting?: boolean;
  /** AIへの問い合わせが走っている(地図データの結果を出した後ろで動いている) */
  aiPending?: boolean;
  onAdd: () => void;
  onClose: () => void;
  /** 地図の寄せ先を「パネルに隠れていない側の中心」にするため、外から実寸を測る */
  ref?: React.Ref<HTMLDivElement>;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  // 入力欄の候補。シリーズは行ごとの欄が全部で共有する(同じ`datalist`を参照する)
  const categoryListId = useId();
  const seriesListId = useId();
  const allowedStatuses = (role ? ALLOWED_STATUS_BY_ROLE[role] : ["private"]).filter(
    (s) => s !== "private"
  ) as SpotStatus[];
  const checkedRows = rows.filter((r) => r.checked && !r.candidate.existing);
  // 登録済みの行はチェックできないので、「すべて」の対象から外す
  const selectableRows = rows.filter((r) => !r.candidate.existing);
  const allSelected = selectableRows.length > 0 && checkedRows.length === selectableRows.length;
  // **追加できる行だけを見る。** 登録済み・座標なしの行は追加の対象外なので、
  // そこに地域が無いことを理由に全行共通の既定を求めると、埋めても意味の無い欄が出る
  // **収集から取り出した画面かどうか。** 0件のときも見分けたいので、行が無くても
  // 円の判定(`coverage`)があればそちら —— 「探して0件」と「まだ集めていない」は別物
  const collected =
    !!coverage || (rows.length > 0 && rows.every((r) => r.source === "collect"));
  const needsFallbackRegion = selectableRows.some(
    (r) => !r.candidate.region && !(r.candidate.lat === 0 && r.candidate.lng === 0)
  );

  // 地図の印を押したときに、その行が見える位置までスクロールする
  useEffect(() => {
    if (focusedNo == null) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-no="${focusedNo}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [focusedNo]);

  // **狭い画面では下から敷く帯にする。** 右の帯(w-2/5)のままだと、スマホの幅では
  // 150px前後しか残らず、行の中身が1文字ずつ縦に折り返される。上に地図が残るので、
  // 行を押してそこへ寄せるという使い方は変わらない。
  // **高さは半分まで**にして、上半分の地図を必ず残す —— 候補を押して位置を確かめる
  // のがこのパネルの使い方なので、地図が3割しか見えないと確かめる先が無い。
  // そのぶん上下の操作は詰めてある(見出しにAIのやり取り、状態は追加ボタンと同じ行)
  return (
    <div
      ref={ref}
      className="absolute bottom-0 left-0 right-0 top-1/2 z-20 flex flex-col overflow-hidden rounded-t-xl bg-white/95 shadow-xl backdrop-blur sm:left-auto sm:top-40 sm:w-2/5 sm:max-w-sm sm:rounded-tr-none"
    >
      <div className="border-b border-gray-200 p-2 sm:p-3">
        {/* **どこから来た候補かを見出しに出す。** 同じ器で「その場で探したもの」と
            「依頼して溜めたものを取り出したもの」の両方を並べるので、
            見出しが「この周辺を探す」のままだと取り違える */}
        <p className="text-xs text-gray-500">{collected ? "この周辺の集めた情報" : "この周辺を探す"}</p>
        {/* **AIとのやり取りは見出しの右**。下の操作に置くと、追加までの手順の中に
            「見るだけ」のボタンが挟まって縦を1行ぶん食う */}
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-bold leading-snug">候補 {rows.length}件(チェック {checkedRows.length}件)</h2>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* **まとめて選ぶ・まとめて外す。** 最初のチェックは出どころとAIの精査で
                決まる(下の`checked`の注記)ので、その判断ごと引き受けたい・捨てたいときに使う。
                何件になるかは追加ボタンの文字に出るので、ここでは断りを挟まない */}
            <button
              type="button"
              onClick={() => onToggleAll(!allSelected)}
              disabled={selectableRows.length === 0}
              className="whitespace-nowrap rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 disabled:opacity-50"
            >
              {allSelected ? "すべて外す" : "すべて選ぶ"}
            </button>
            {onShowExchange && (
              <button
                type="button"
                onClick={onShowExchange}
                className="whitespace-nowrap rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600"
              >
                AIとのやり取り
              </button>
            )}
          </div>
        </div>
        {/* 狭い画面では出さない。**使い方の説明より一覧そのものの行数を優先する**
            (2行ぶんの説明で候補が1件隠れる) */}
        <p className="mt-0.5 hidden text-xs text-gray-500 sm:block">
          行を押すと地図がそこへ寄ります。候補は保存されず、追加したものだけがスポットになります。
        </p>
        {/* **円の中の収集の進み具合。** 集まっているぶんは一覧に出したうえで、
            足りない範囲をここで言う —— 「0件」と「まだ集めていない」は別のことで、
            後者なら集めさせれば済む */}
        {coverage &&
          (coverage.total === 0 ? (
            <p className="mt-1.5 rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">
              この範囲には区画がありません(まだ区画を割っていないか、対象の外です)。
            </p>
          ) : coverage.pending.length > 0 ? (
            <div className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
              <p>
                まだ集めていない区画があります:{" "}
                <span className="font-medium">
                  {coverage.total - coverage.scanned}/{coverage.total}区画
                </span>
              </p>
              {onCollectMissing && (
                <button
                  type="button"
                  onClick={onCollectMissing}
                  disabled={collectStarting}
                  className="mt-1 rounded border border-amber-600 px-2 py-0.5 font-medium text-amber-800 disabled:opacity-50"
                >
                  {collectStarting ? "起動中…" : "この範囲をいま集める"}
                </button>
              )}
            </div>
          ) : (
            <p className="mt-1.5 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
              この範囲({coverage.total}区画)は収集済みです。
              {coverage.deep < coverage.total &&
                ` 詳細調査は ${coverage.deep}/${coverage.total} 区画まで進んでいます。`}
            </p>
          ))}
        {/* **AIは地図データの結果を出した後ろで動く**ので、待っていることを出さないと
            「もう終わったのか、まだ来るのか」が分からない */}
        {aiPending && (
          <p className="mt-1.5 rounded bg-violet-50 px-2 py-1 text-xs text-violet-800">
            AIが精査しています… 選ばれた候補に印が付き、地図データに無いものが足されます
          </p>
        )}
      </div>

      <ul ref={listRef} className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto">
        {rows.length === 0 && (
          <li className="p-3 text-xs text-gray-500">
            {collected
              ? "この範囲からはまだ何も集まっていません。集め終わるとここに並びます。"
              : "候補がありません。「もう一度探す」から検索語・半径を変えて探せます。"}
          </li>
        )}
        {rows.map((row) => {
          const c = row.candidate;
          // **座標が無い候補は選べない。** 集めたものは地図辞典で引き当てられない
          // ことがあり、そのまま入れると赤道上(0,0)にスポットが立つ。
          // 「位置を直す」で住所から引ければ選べるようになる
          const noPoint = c.lat === 0 && c.lng === 0;
          const disabled = !!c.existing || noPoint;
          const focused = row.no === focusedNo;
          // **薄くするのは「登録済み」と「地図データで実在を確かめられなかった」の2つだけ。**
          // かつては参照URLの無い行を薄くしていたが、URLはAIが書いた文字列でしかなく
          // 確かめる相手がいない。しかも地図データ側の候補はURLを持たないものが多く
          // (OSMは実測で200件中51件)、**意味の無い理由で行の大半が薄くなっていた**。
          // 印の色分け・最初から選んでおくかの判定と同じ根拠にそろえる
          // **AIが見たうえで選ばなかった行も薄くする。** チェックは外れているので、
          // 一覧を上から追うときに「残っているが対象外」だと分かる必要がある
          const dubious =
            (row.source === "ai" && !c.location_verified) || row.reviewed === "dropped";
          return (
            <li
              key={row.no}
              data-no={row.no}
              className={`px-2 py-2 ${
                focused ? "bg-blue-50 ring-1 ring-inset ring-blue-400" : ""
              } ${disabled || dubious ? "opacity-60" : ""}`}
            >
              {/* **横に並べるのは「選ぶ・読む・外す」だけ。** 行ごとの操作(ランク・
                  位置を直す・リンク)まで同じ横並びに入れると、1列が数十pxまで潰れて
                  文字が1文字ずつ縦に折り返される。操作は下の行へ出し、幅いっぱいで折り返す */}
              <div className="flex items-start gap-2">
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
                    {/* **番号の色は地図の印と同じ**(地図データ=青、AI=紫、登録済み=灰)。
                        ここだけ一律に紫だった頃は、地図で青い印を押しても一覧の番号が
                        紫で出るので、どの候補と対応しているのか色から読めなかった */}
                    <span
                      className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-xs font-bold text-white ${
                        disabled
                          ? "bg-gray-500"
                          : row.source === "ai"
                            ? "bg-violet-600"
                            : row.source === "collect"
                              ? "bg-teal-600"
                              : "bg-sky-600"
                      }`}
                    >
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
                      className={`rounded px-1 py-0.5 font-medium text-white ${
                        row.source === "map"
                          ? "bg-sky-600"
                          : row.source === "collect"
                            ? "bg-teal-600"
                            : "bg-violet-600"
                      }`}
                    >
                      {DISCOVERY_SOURCE_LABELS[row.source]}
                    </span>
                    {/* **AIの精査の結果は出どころの隣に出す。** 地図データの行に
                        ジャンル・ランク・一言が付いているのは精査を通ったからで、
                        その断りが無いと辞典が持っていた値に見える */}
                    {row.reviewed === "picked" && (
                      <span className="rounded bg-violet-100 px-1 py-0.5 text-violet-800">
                        AIが選定
                      </span>
                    )}
                    {row.reviewed === "dropped" && (
                      <span className="rounded bg-gray-100 px-1 py-0.5 text-gray-600">
                        AIは選ばず
                      </span>
                    )}
                    {c.existing ? (
                      <span className="rounded bg-gray-200 px-1 py-0.5 text-gray-700">
                        登録済み: {c.existing.name}
                      </span>
                    ) : noPoint ? (
                      <span className="rounded bg-red-50 px-1 py-0.5 text-red-700">
                        座標なし(位置を直す)
                      </span>
                    ) : row.relocated ? (
                      <span className="rounded bg-green-100 px-1 py-0.5 text-green-800">住所から取得</span>
                    ) : row.source === "ai" ? (
                      /* **実在を確かめられたかどうかを言い切る。** AIの候補で
                         いちばん危ないのは「その場所に無い店」なので、位置の話ではなく
                         地図データに在ったかどうかとして出す */
                      c.location_verified ? (
                        <span className="rounded bg-green-100 px-1 py-0.5 text-green-800">
                          地図データで確認
                        </span>
                      ) : (
                        <span className="rounded bg-amber-100 px-1 py-0.5 text-amber-800">
                          地図データに無い
                        </span>
                      )
                    ) : null}
                    {/* 距離は探した中心があるときだけ。集めたものには中心が無い */}
                    {row.source !== "collect" && (
                      <span className="rounded bg-gray-100 px-1 py-0.5 text-gray-600">
                        {c.distance_m >= 1000
                          ? `${(c.distance_m / 1000).toFixed(1)} km`
                          : `${c.distance_m} m`}
                      </span>
                    )}
                    {/* **半径の外に出た候補は必ず言う。** 頼んだ範囲を無視して数を
                        合わせにくることがあり(実測)、地図で見るまで気づけない */}
                    {c.distance_m > row.radius && (
                      <span className="rounded bg-red-50 px-1 py-0.5 text-red-700">半径の外</span>
                    )}
                  </div>
                  {c.summary && <p className="text-xs leading-snug text-gray-700">{c.summary}</p>}
                </button>
                <button
                  type="button"
                  aria-label="候補から外す"
                  onClick={() => onRemove(row.no)}
                  className="shrink-0 px-1 text-lg leading-none text-gray-400 hover:text-red-500"
                >
                  ×
                </button>
              </div>
              {/* 行ごとの操作。**幅いっぱいを使って折り返す**(要素ごとに折り返すので、
                  文字の途中では切れない)。チェックボックスのぶんだけ字下げして、
                  上の行の名前と縦にそろえる */}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-[11px]">
                {/* **シリーズは行ごとに直せる。** 初期値は候補のジャンルで、これが
                    ピンの中身と色になる。地図データの分類は実態と食い違うことがある
                    (麺類の店が「和食」など)ので、追加してから1件ずつ編集し直すより
                    ここで直すほうが早い */}
                <label className="flex items-center gap-1 text-gray-600">
                  シリーズ
                  <input
                    value={discoveryRowSeries(row)}
                    disabled={disabled}
                    list={seriesListId}
                    onChange={(e) => onRowSeriesChange(row.no, e.target.value)}
                    placeholder="なし"
                    className="w-24 rounded border border-gray-300 px-1 py-0.5 text-xs"
                  />
                </label>
                {rankEnabled && (
                  <label className="flex items-center gap-1 text-gray-600">
                    ランク
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
                  </label>
                )}
                {/* 位置がずれていると思ったときに、その1件だけ住所から引き直す。
                    AIの座標は当てにならないことがあるので、気づいた行だけ直せればよい */}
                {c.address && (
                  <button
                    type="button"
                    onClick={() => onRelocate(row.no)}
                    disabled={relocatingNo === row.no}
                    title={`「${c.address}」から位置を引き直す`}
                    className="whitespace-nowrap text-blue-600 underline disabled:opacity-50"
                  >
                    {relocatingNo === row.no ? "取得中…" : "位置を直す"}
                  </button>
                )}
                {c.url && (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="whitespace-nowrap text-blue-600 underline"
                  >
                    参照
                  </a>
                )}
                {/* **候補の座標と、店名で引いた本物の場所を1枚の地図に並べる。**
                    経路検索の出発地に座標・目的地に店名を入れる形(検索は問い合わせを
                    1つしか受け取れないので、2地点を同時に出すにはこれになる)。
                    **ずれが距離として出る**ので、目で見比べるより判断が速い。
                    行の本体はボタンなので、リンクはその外に置く(入れ子にできない) */}
                <a
                  href={buildGoogleMapsCompareUrl(
                    { lat: c.lat, lng: c.lng },
                    c.name,
                    c.address ?? c.region
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="この候補の座標から店名で引いた場所までをGoogle マップで出す(離れていれば座標が違う)"
                  className="whitespace-nowrap text-blue-600 underline underline-offset-2 hover:text-blue-800"
                >
                  座標と店名を見比べる
                </a>
              </div>
            </li>
          );
        })}
      </ul>

      {/* 下の操作は**狭い画面では詰める**(一覧に回せる高さがそのぶん増える) */}
      <div className="space-y-1.5 border-t border-gray-200 p-2 sm:space-y-2 sm:p-3">
        {/* 入力欄の候補。カテゴリは一括の欄、シリーズは行ごとの欄が参照する */}
        <datalist id={categoryListId}>
          {categoryOptions.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <datalist id={seriesListId}>
          {seriesOptions.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
        {/* 地域が取れなかった候補があるときだけ、全行共通の既定を選ばせる */}
        {needsFallbackRegion && (
          <div>
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
        {/* **追加する全件に足すカテゴリ。** 候補ごとの分類はシリーズが受け持つので、
            ここは「この一帯はラーメン」のようなまとめの札を1回で足すための欄 */}
        <label className="flex items-center gap-2 text-[11px] font-medium text-gray-600">
          <span className="shrink-0">カテゴリを全件に追加</span>
          <input
            value={category}
            list={categoryListId}
            onChange={(e) => onCategoryChange(e.target.value)}
            placeholder="任意"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm font-normal"
          />
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {/* **状態は見出しを付けず追加ボタンと同じ行に置く。** 追加するときにしか
            使わない選択なので、押すボタンの隣にあれば何の状態かは読める */}
        <div className="flex gap-2">
          <select
            value={status}
            onChange={(e) => onStatusChange(e.target.value as SpotStatus)}
            aria-label="追加する状態"
            className="w-24 shrink-0 rounded-lg border border-gray-300 px-2 py-2 text-sm"
          >
            {allowedStatuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onAdd}
            disabled={adding || checkedRows.length === 0}
            className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {adding ? "追加中…" : `${checkedRows.length}件を追加`}
          </button>
        </div>
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
