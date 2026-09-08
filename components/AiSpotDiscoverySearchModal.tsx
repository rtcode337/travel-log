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
  type DiscoveryReviewTarget,
  type DiscoverySource,
} from "@/lib/spotDiscovery";

/**
 * 周辺スポット探しの入口。**探し方は選ばせない** —— まず地図データを引き、
 * **その結果をAIに精査させるかどうか**だけをチェックボックスで選ぶ:
 *
 * | 段 | かかる時間 | やること |
 * |---|---|---|
 * | **地図データ**(必ず走る) | 2〜9秒(半径による) | 正確な名前と座標を漏らさず集める |
 * | **AIの精査**(任意) | 15秒〜2分 | 一覧から選ぶ・ジャンルとランクを付ける・地図に無いものを足す |
 *
 * **既定で地図データだけにしてあるのは、「近くの飲食店をちょっと見たい」が主な使い方だから。**
 * AIだけの頃は1回に3分近くかかって使い物にならなかった。
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
  onAiFollowUp,
  onRadiusChange,
}: {
  /** 探索の中心座標(右クリック/長押しした地点) */
  lat: number;
  lng: number;
  spotTypeKey: string;
  /** 前回の入力(「もう一度探す」のとき) */
  initial?: { query: string; radius: number; limit: number; aiAssist?: boolean };
  onClose: () => void;
  onResult: (
    result: DiscoveryResult,
    params: {
      query: string;
      radius: number;
      limit: number;
      source: DiscoverySource;
      aiAssist?: boolean;
    }
  ) => void;
  /**
   * 「AIに精査させる」が入っていたときに、**この画面を閉じたあとで**
   * 呼び出し側にAIへ聞かせる。ここで待たないのは、地図データの結果を見ながら
   * 待てるようにするため(AIは15秒〜2分かかる)。
   *
   * **精査させる候補(`known`)はここで渡す** —— 呼び出し側の一覧(state)は
   * この時点ではまだ更新されておらず、あちらから今回の結果を読むことはできない。
   * 前回の探索で並んでいた候補を混ぜないという意味でも、今回のぶんだけを渡すのが正しい
   */
  onAiFollowUp?: (req: {
    query: string;
    radius: number;
    limit: number;
    depth: DiscoveryDepth;
    choice: DiscoveryChoice;
    known: DiscoveryReviewTarget[];
  }) => void;
  /** 半径が決まる・変わるたびに知らせる(地図に探す範囲の円を出すため) */
  onRadiusChange?: (radius: number) => void;
}) {
  const [query, setQuery] = useState(initial?.query ?? "");
  const [radius, setRadius] = useState<number>(initial?.radius ?? DEFAULT_DISCOVERY_RADIUS);
  const [limit, setLimit] = useState<number>(initial?.limit ?? DEFAULT_DISCOVERY_LIMIT);
  // **AIは「足りないぶんを補う」後段**なので、探し方の選択ではなくチェックボックス。
  // **既定は入れておく** —— 地図データは半径の中に在るものを全部並べるだけで、
  // 探しているものに合うかも記録する価値があるかも見ていない(半径300mで千件を超える)。
  // 精査を通さないほうが例外なので、外したいときに外す形にする。
  // 前回外していたら次も外しておく(`initial`は「もう一度探す」から渡る前回の選択)
  const [aiAssist, setAiAssist] = useState(initial?.aiAssist ?? true);
  // AIで探すときの念の入れ方。**既定はさっくり** —— 待てるのはせいぜい数十秒なので、
  // 裏取りまで頼むのは「しっかり」を選んだときだけにする
  const [depth, setDepth] = useState<DiscoveryDepth>(DEFAULT_DISCOVERY_DEPTH);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 待ち時間を秒で見せる。**地図データも数秒かかる**(半径の中を全部引くので、
  // 実測で300m=2.2秒・1km=6.6秒)ので、止まって見えないように出す
  const [elapsed, setElapsed] = useState(0);

  // 開いた時点と選び直した時点で、地図に出す円の半径を知らせる
  useEffect(() => {
    onRadiusChange?.(radius);
  }, [radius, onRadiusChange]);

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
    // 検索語なしでも「周辺の何か」を並べられる(必須にしない)
    setSearching(true);
    setError(null);
    // 地図データは上限を渡さない(半径の中を全部返す)
    const { data, error } = await api.spots.nearby(spotTypeKey, {
      lat,
      lng,
      radius,
      query: q,
      limit: 0,
    });
    setSearching(false);
    if (error || !data) {
      // **AIで補うつもりなら、地図データが引けなくても止めない** ——
      // 日本以外の種別では地図データそのものが使えないので、そこで止めると
      // AIにも聞けなくなる
      if (!aiAssist) {
        setError(error?.message ?? "探索に失敗しました。");
        return;
      }
    } else {
      onResult(data, { query: q, radius, limit, source: "map", aiAssist });
    }
    if (aiAssist) {
      // **精査に渡すのは中心から近い順に`limit`件まで。** 地図データは半径の中を
      // 全部返す(300mで約1,800件)ので、そのまま渡せばプロンプトが読み切れない長さになり、
      // 答えもそのぶん延びる。**登録済みのものは渡さない**(追加できないので精査しても使えない)
      const known: DiscoveryReviewTarget[] = (data?.candidates ?? [])
        .filter((c) => !c.existing)
        .slice(0, limit)
        .map((c) => ({ name: c.name, genre: c.genre, distance_m: c.distance_m }));
      // **AIは呼び出し側に投げて、この画面は閉じる。** 地図データの結果を見ながら
      // 待てるようにするため(ここで待つと、出ている結果が見えないまま数十秒止まる)
      onAiFollowUp?.({ query: q, radius, limit, depth, choice, known });
    }
    onClose();
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

        {/* **探し方は選ばせない。** まず地図データを引き、AIはその結果を精査する
            後段として任意で足す —— AIと地図データに別々のものを探させると、
            同じ店が二重に並ぶうえ、AIが「地図に載っている当たり前の店」を挙げるのに
            時間を使う。得意なことが違うので役割で分ける */}
        <p className="text-xs text-gray-500">
          地図データ(Overture MapsとOpenStreetMap)から引きます。座標は正確ですが、
          探しているものに合うかどうかは見ておらず、説明文も付きません。
        </p>
        <label className="flex items-start gap-2 rounded-lg border border-gray-300 p-2.5 text-sm">
          <input
            type="checkbox"
            checked={aiAssist}
            disabled={searching}
            onChange={(e) => setAiAssist(e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span className="min-w-0">
            AIに精査させる
            <span className="block text-xs font-normal text-gray-500">
              地図データを出したあとで、AIが一覧から選び直し、ジャンル・ランク・一言を
              付けます。あわせて地図データに無いスポットも足します
              (15秒〜2分かかりますが、地図データの結果は先に出ます)
            </span>
          </span>
        </label>

        {/* 念の入れ方。**遅さの一番の原因は裏取りの検索回数**なので、
            件数や相手より先にここを選ばせる */}
        {aiAssist && (
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
        {aiAssist && (
          <p className="text-xs text-gray-500">
            {depth === "quick"
              ? "webの検索を2回までに抑えて手早く精査してもらいます。裏取りをしないので、足した候補に参照URLが付かないことがあります。"
              : "1件ずつweb検索で確かめ、根拠のURLを付けてもらいます。そのぶん時間がかかります。"}
          </p>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">
            探すもの
          </label>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={MAX_DISCOVERY_QUERY_LENGTH}
            placeholder="例: ランチ、ラーメン、カフェ(空でも可)"
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
          {/* **件数はAIに聞くときだけ選ばせる。** 返させる件数がそのまま待ち時間に
              なるのはAIの側の事情で、地図データはローカルを引くだけなので上限を持たない
              (半径の中にあるものを全部並べる)。半径がそのまま件数を決める。
              **AIに渡すのは近い順にこの件数まで**で、足させる候補の上限も同じ値 */}
          {aiAssist ? (
            <div>
              <label className="mb-1 block text-sm font-medium">AIに任せる件数</label>
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
          ) : (
            <div>
              <span className="mb-1 block text-sm font-medium">件数</span>
              <p className="rounded-lg border border-dashed border-gray-300 px-2 py-2 text-sm text-gray-600">
                半径の中を全部
              </p>
            </div>
          )}
        </div>

        {/* AIの設定。**ふだんは触らないので畳んでおく**が、畳んだままでも
            いまの選択が見えるようにする(何で探すのかが分からないまま待たせない)。
            AIに聞かないときは効かないので出さない */}
        {aiAssist && (
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
          {aiAssist &&
            "精査に渡すのは中心から近い順にこの件数までです(地図データは半径の中を全部並べます)。"}
          足りなければ、結果のパネルから「もう一度探す」で条件を変えて同じ一覧に足せます。
          AIに聞いた後は、同じパネルの見出しにある「AIとのやり取り」で頼んだ本文と返答を確かめられます。
        </p>
        {searching && (
          <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
            地図データを引いています… {elapsed}秒
            {aiAssist && (
              <span className="mt-0.5 block text-xs text-blue-700/80">
                このあとAIが精査します{" "}
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
            disabled={searching}
            className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {searching ? "調べています…" : "探す"}
          </button>
        </div>
      </form>
    </div>
  );
}
