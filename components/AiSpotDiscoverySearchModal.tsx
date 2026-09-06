"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import {
  DEFAULT_DISCOVERY_LIMIT,
  DEFAULT_DISCOVERY_RADIUS,
  DISCOVERY_LIMIT_OPTIONS,
  DISCOVERY_RADIUS_OPTIONS,
  DEFAULT_DISCOVERY_DEPTH,
  DISCOVERY_DEPTHS,
  DISCOVERY_DEPTH_LABELS,
  MAX_DISCOVERY_QUERY_LENGTH,
  type DiscoveryChoice,
  type DiscoveryDepth,
  type DiscoveryOptions,
  type DiscoveryResult,
  type DiscoverySource,
} from "@/lib/spotDiscovery";

/**
 * 周辺スポット探しの入口。**探し方を2つから選ぶ**のがこの画面の要:
 *
 * | 探し方 | かかる時間 | 得意なもの |
 * |---|---|---|
 * | **地図データ**(既定) | 1秒かからない | 正確な座標。AIの枠を使わない |
 * | **AIでweb検索** | 30秒〜2分 | 地図に載っていない新しい店、一言の説明、参照URL |
 *
 * **既定を地図データにしてあるのは、「近くの飲食店をちょっと見たい」が主な使い方だから。**
 * AIだけの頃は1回に3分近くかかって使い物にならなかった。まず地図データで雑に集め、
 * 足りなければパネルの「もう一度探す」からAIで探し足す(同じ一覧に混ざる)、が想定の流れ。
 *
 * **AIの相手・モデル・考える深さもここで選ぶ**(AIを選んだときだけ出る折り畳み)。
 * 管理画面に置かないのは、その場の目的で軽くも重くもしたい設定だから —— 全員ぶんを
 * 1つに決めさせると、使う人が選び直せない。**選んだ内容はこの端末に覚える**
 * (localStorage。サーバーには保存しないので、他の人の探索には影響しない)。
 *
 * 結果は自分では並べず、`onResult`で地図側へ渡す —— 候補は地図に印として描き、
 * 右側のパネル(`AiSpotDiscoveryPanel`)で選ぶため。
 * 2回目以降(パネルの「もう一度探す」)は前回の入力を初期値にする。
 */

/** AIの設定を覚えておくキー(端末ごと。種別はまたいで共通でよい) */
const CHOICE_STORAGE_KEY = "travel-log:ai-discovery-choice";

function loadChoice(): DiscoveryChoice {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CHOICE_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const o = parsed as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    return {
      backend: str(o.backend),
      model: str(o.model),
      effort: str(o.effort),
      depth: (DISCOVERY_DEPTHS as readonly string[]).includes(String(o.depth))
        ? (o.depth as DiscoveryDepth)
        : null,
    };
  } catch {
    return {};
  }
}

function saveChoice(choice: DiscoveryChoice): void {
  try {
    window.localStorage.setItem(CHOICE_STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // 保存できなくても探索そのものは動く(プライベートモード等)
  }
}

export default function AiSpotDiscoverySearchModal({
  lat,
  lng,
  spotTypeKey,
  initial,
  onClose,
  onResult,
}: {
  /** 探索の中心座標(右クリック/長押しした地点) */
  lat: number;
  lng: number;
  spotTypeKey: string;
  /** 前回の入力(「もう一度探す」のとき) */
  initial?: { query: string; radius: number; limit: number; source?: DiscoverySource };
  onClose: () => void;
  onResult: (
    result: DiscoveryResult,
    params: { query: string; radius: number; limit: number; source: DiscoverySource }
  ) => void;
}) {
  const [query, setQuery] = useState(initial?.query ?? "");
  const [radius, setRadius] = useState<number>(initial?.radius ?? DEFAULT_DISCOVERY_RADIUS);
  const [limit, setLimit] = useState<number>(initial?.limit ?? DEFAULT_DISCOVERY_LIMIT);
  // 2回目は前回と違う探し方をしたいことが多い(地図で集めた後にAIで足す)ので、
  // 前回がAIだったときだけAIを初期値にする
  const [source, setSource] = useState<DiscoverySource>(initial?.source ?? "osm");
  // AIで探すときの念の入れ方。**既定はさっくり** —— 待てるのはせいぜい数十秒なので、
  // 裏取りまで頼むのは「しっかり」を選んだときだけにする
  const [depth, setDepth] = useState<DiscoveryDepth>(DEFAULT_DISCOVERY_DEPTH);
  const [searching, setSearching] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // AIの設定(相手・モデル・深さ)。空文字=「既定に任せる」
  const [options, setOptions] = useState<DiscoveryOptions | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [choice, setChoice] = useState<DiscoveryChoice>({});

  useEffect(() => {
    const saved = loadChoice();
    setChoice(saved);
    if (saved.depth) setDepth(saved.depth);
    api.spots.discoverOptions(spotTypeKey).then(({ data }) => setOptions(data ?? null));
  }, [spotTypeKey]);

  // 待ち時間を秒で見せる(何も動かない画面で待たせると、固まったように見える)
  useEffect(() => {
    if (!searching) return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000
    );
    return () => window.clearInterval(timer);
  }, [searching]);

  // 選んだ相手(未選択なら既定の相手)。モデル・深さの選択肢はこの相手のもの
  const activeBackend = useMemo(() => {
    const id = choice.backend || options?.defaultBackend;
    return options?.backends.find((b) => b.id === id) ?? null;
  }, [choice.backend, options]);

  // 畳んだ見出しに出す、いまの選択の一行
  const choiceSummary = [
    activeBackend?.label ?? choice.backend ?? options?.defaultBackend ?? "既定",
    choice.model,
    choice.effort ?? (activeBackend?.efforts.length ? options?.defaultEffort : null),
  ]
    .filter(Boolean)
    .join(" / ");

  const update = (patch: DiscoveryChoice) => {
    setChoice((prev) => {
      // 相手を変えたら、その相手に無いモデル・深さは持ち越さない
      const next = patch.backend !== undefined ? { ...prev, ...patch, model: null, effort: null } : { ...prev, ...patch };
      saveChoice(next);
      return next;
    });
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    // 地図データは検索語なしでも「周辺の何か」を並べられる(AIは何を探すか要る)
    if (source === "ai" && !q) return;
    setSearching(true);
    setError(null);
    const params = { lat, lng, radius, query: q, limit };
    const { data, error } =
      source === "osm"
        ? await api.spots.nearby(spotTypeKey, params)
        : await api.spots.discover(spotTypeKey, { ...params, ...choice, depth });
    setSearching(false);
    if (error || !data) {
      setError(error?.message ?? "探索に失敗しました。");
      return;
    }
    onResult(data, { query: q, radius, limit, source });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={searching ? undefined : onClose}
    >
      <form
        onSubmit={search}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-4"
      >
        <h2 className="font-bold">この周辺を探す</h2>
        <p className="text-xs text-gray-500">
          緯度 {lat.toFixed(5)} ・ 経度 {lng.toFixed(5)} を中心に、見つかった候補を地図に出します。
        </p>

        {/* 探し方。**既定は速いほう** —— ちょっと見たいだけのときにAIを待たせない */}
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: "osm", label: "地図データ", note: "すぐ出る" },
              { value: "ai", label: "AIでweb検索", note: "15秒〜2分" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSource(opt.value)}
              disabled={searching}
              aria-pressed={source === opt.value}
              className={`rounded-lg border px-2 py-2 text-left text-sm disabled:opacity-50 ${
                source === opt.value
                  ? "border-blue-500 bg-blue-50 font-medium text-blue-800"
                  : "border-gray-300 text-gray-600"
              }`}
            >
              {opt.label}
              <span className="block text-xs font-normal text-gray-500">{opt.note}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {source === "osm"
            ? "地図データ(OpenStreetMap)から引きます。座標は正確ですが、新しい店は載っていないことが多く、説明文は付きません。"
            : "AIがwebを調べます。地図に無い新しい店や、一言の説明が付きます。"}
        </p>

        {/* 念の入れ方。**遅さの一番の原因は裏取りの検索回数**なので、
            件数や相手より先にここを選ばせる */}
        {source === "ai" && (
          <div className="grid grid-cols-2 gap-2">
            {DISCOVERY_DEPTHS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDepth(d);
                  update({ depth: d });
                }}
                disabled={searching}
                aria-pressed={depth === d}
                className={`rounded-lg border px-2 py-1.5 text-left text-sm disabled:opacity-50 ${
                  depth === d
                    ? "border-blue-500 bg-blue-50 font-medium text-blue-800"
                    : "border-gray-300 text-gray-600"
                }`}
              >
                {DISCOVERY_DEPTH_LABELS[d].label}
                <span className="block text-xs font-normal text-gray-500">
                  {DISCOVERY_DEPTH_LABELS[d].note}
                </span>
              </button>
            ))}
          </div>
        )}
        {source === "ai" && (
          <p className="text-xs text-gray-500">
            {depth === "quick"
              ? "webの検索を2回までに抑えて手早く挙げてもらいます。裏取りをしないので、参照URLが付かない候補が増えます。"
              : "1件ずつweb検索で確かめ、根拠のURLを付けてもらいます。そのぶん時間がかかります。"}
          </p>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">
            探すもの {source === "ai" && "*"}
          </label>
          <input
            autoFocus
            required={source === "ai"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={MAX_DISCOVERY_QUERY_LENGTH}
            placeholder={
              source === "osm" ? "例: ランチ、ラーメン、カフェ(空でも可)" : "例: ランチ、ラーメン、カフェ"
            }
            disabled={searching}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-sm font-medium">半径</label>
            <select
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              disabled={searching}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            >
              {DISCOVERY_RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r >= 1000 ? `${r / 1000} km` : `${r} m`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">件数(上限)</label>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              disabled={searching}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            >
              {DISCOVERY_LIMIT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}件
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* AIの設定。**ふだんは触らないので畳んでおく**が、畳んだままでも
            いまの選択が見えるようにする(何で探すのかが分からないまま待たせない)。
            地図データで探すときは効かないので出さない */}
        {source === "ai" && (
        <div className="rounded-lg border border-gray-200">
          <button
            type="button"
            onClick={() => setShowSettings((prev) => !prev)}
            aria-expanded={showSettings}
            disabled={searching}
            className="flex w-full items-center justify-between gap-2 p-2.5 text-left text-sm disabled:opacity-50"
          >
            <span className="min-w-0">
              <span className="font-medium">AIの設定</span>
              <span className="ml-1 truncate text-xs text-gray-500">{choiceSummary}</span>
            </span>
            <span className="shrink-0 text-xs text-gray-500">{showSettings ? "▲" : "▼"}</span>
          </button>
          {showSettings && (
            <div className="space-y-2 border-t border-gray-100 p-2.5">
              {options?.error && (
                <p className="text-xs text-red-600">
                  相手の一覧を取れませんでした: {options.error}
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="block text-xs text-gray-600">
                  相手
                  <select
                    value={choice.backend ?? ""}
                    disabled={searching}
                    onChange={(e) => update({ backend: e.target.value || null })}
                    className="mt-0.5 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">既定({options?.defaultBackend ?? "-"})</option>
                    {options?.backends.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </label>
                {/* モデルを選べる相手のときだけ出す */}
                {(activeBackend?.models.length ?? 0) > 1 && (
                  <label className="block text-xs text-gray-600">
                    モデル
                    <select
                      value={choice.model ?? ""}
                      disabled={searching}
                      onChange={(e) => update({ model: e.target.value || null })}
                      className="mt-0.5 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">相手の既定</option>
                      {activeBackend?.models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {(activeBackend?.efforts.length ?? 0) > 0 && (
                  <label className="block text-xs text-gray-600">
                    考える深さ
                    <select
                      value={choice.effort ?? ""}
                      disabled={searching}
                      onChange={(e) => update({ effort: e.target.value || null })}
                      className="mt-0.5 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">既定({options?.defaultEffort})</option>
                      {activeBackend?.efforts.map((ef) => (
                        <option key={ef} value={ef}>
                          {ef}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <p className="text-xs text-gray-500">
                軽いモデル・低い深さほど早く返ります(実測で32秒〜3分半の開き)。この端末にだけ覚えます。
              </p>
            </div>
          )}
        </div>
        )}

        <p className="text-xs text-gray-500">
          足りなければ、結果のパネルから「もう一度探す」で探し方を変えて同じ一覧に足せます。
          AIで探した後は、同じパネルから「AIとのやり取りを見る」で頼んだ本文と返答を確かめられます。
        </p>
        {searching && (
          <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
            {source === "osm" ? "地図データを引いています…" : `AIがwebで調べています… ${elapsed}秒`}
            {source === "ai" && (
              <span className="mt-0.5 block text-xs text-blue-700/80">
                {depth === "quick"
                  ? "ふだんは15〜30秒ほどです。遅いときは件数を減らしてください。"
                  : "裏取りをするので40秒〜2分ほどかかります。急ぐときは「さっくり」に変えてください。"}
              </span>
            )}
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={searching}
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={searching || (source === "ai" && !query.trim())}
            className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {searching ? "調べています…" : "探す"}
          </button>
        </div>
      </form>
    </div>
  );
}
