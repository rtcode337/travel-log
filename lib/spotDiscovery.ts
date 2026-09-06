import type { Rank } from "./rank";

/**
 * 周辺スポットのAI探索(`/api/spots/discover`)でサーバーと画面が共有する型と、
 * 候補をスポットに写すときの決まりごと。
 *
 * **探索の結果は保存しない。** 画面で選んで追加したものだけが通常のスポット
 * (`origin='manual'`)になり、還元用エクスポートにも乗る。候補の一覧は
 * 閉じれば消える(同じ場所をもう一度探せば取り直せる)。
 *
 * サーバー側の環境変数(`CHIEZO_BASE_URL`等)はここでは読まない ——
 * このモジュールはクライアントコンポーネントからも読む。
 */

/** 探索の半径(m)として選べる値。狭すぎると何も出ず、広すぎると中心と関係ない店が混ざる */
export const DISCOVERY_RADIUS_OPTIONS = [300, 500, 1000, 2000, 5000] as const;
export const DEFAULT_DISCOVERY_RADIUS = 1000;

/** 検索語の長さの上限。プロンプトに埋めるので、長文を丸ごと渡させない */
export const MAX_DISCOVERY_QUERY_LENGTH = 100;

/**
 * 1回の探索でAIに返させる件数の選択肢と上限。相手は1回ずつしか動かないので
 * まとめて返させるが、**増やすほど答えが長くなって待ちが延びる**。
 * 上限30は外の制約ではなく、「1回の探索で待てる長さ」としてこちらで決めた値
 * (足りなければパネルの「もう一度探す」で同じ一覧に足せる)
 */
export const DISCOVERY_LIMIT_OPTIONS = [10, 20, 30] as const;
export const DEFAULT_DISCOVERY_LIMIT = 10;
export const MAX_DISCOVERY_CANDIDATES = 30;

/**
 * 既存スポットと「同じもの」とみなす距離(m)。名前が一致しなくても、
 * この距離に既存スポットがあれば「登録済み」の印を付ける
 */
export const DISCOVERY_DUPLICATE_DISTANCE_M = 50;

/** 相手(chiezoの`/v1/ai/backends`の1件)。web検索を持つ相手だけが探索に使える */
export interface DiscoveryBackend {
  id: string;
  label: string;
  web: boolean;
  /** その相手で選べるモデル(空なら相手にモデルの概念が無い) */
  models: string[];
  /** その相手で選べるeffort(考える深さ。空なら指定できない) */
  efforts: string[];
}

/**
 * 探索の画面(`AiSpotDiscoverySearchModal`)が最初に読む状態。
 * **相手・モデル・深さは探索の画面で選ぶ**ので、その選択肢もここで配る
 */
export interface DiscoveryOptions {
  /** この種別・この環境・この権限で使えるか(falseならメニューにも出さない) */
  enabled: boolean;
  /** 選べる相手(web検索を持つものだけ)。chiezoに繋がらなければ空 */
  backends: DiscoveryBackend[];
  /** 何も選ばなかったときに使う相手 */
  defaultBackend: string;
  /** 何も選ばなかったときに使う深さ(相手が対応するときだけ効く) */
  defaultEffort: string;
  /** 選択肢を取れなかった理由(取れていればnull) */
  error: string | null;
}

/** 探索のときに画面から渡すAIの設定(未指定は既定に落ちる) */
export interface DiscoveryChoice {
  backend?: string | null;
  model?: string | null;
  effort?: string | null;
  /** 念の入れ方。未指定は`quick`(下の`DISCOVERY_DEPTHS`) */
  depth?: DiscoveryDepth | null;
}

/**
 * 候補の出どころ。**探し方は2段**で、既定は速いほう:
 * - `osm`: 地図データ(chiezoのOSM辞典)。**1秒かからず**、AIの枠も使わない。
 *   座標は地図データそのものなので正確。反面、新しい店は載っていないことが多く、
 *   説明文も持たない(実測: 新宿1kmに飲食店882件あるのに、AIが挙げた有名店4件のうち
 *   OSMで引けたのは1件だけ)
 * - `ai`: web検索を持つAIに調べさせる。30秒〜2分かかるが、**OSMに無い新しい店**や
 *   一言の説明・参照URLが付く
 *
 * 「まず地図データで雑に集め、足りなければAIで探し足す」が想定の流れで、
 * 同じ一覧に混ぜて並ぶ(行に出どころの印が付く)
 */
export type DiscoverySource = "osm" | "ai";

/**
 * AIで探すときの念の入れ方。**既定は`quick`**。
 *
 * | | 頼み方 | 実測(antigravity+low、10件) |
 * |---|---|---|
 * | `quick` | webの検索を2回までに制限し、裏取りをさせない。URLは分かればでよい | **17秒** |
 * | `thorough` | 1件ずつweb検索で確かめさせ、根拠のURLを必須にする | 41秒 |
 *
 * **効くのは検索の回数**。エージェントとして動く相手は、放っておくと候補ごとに
 * 裏取りの検索を回して時間を使う(同じ問いで3分を超えることもあった)。
 * 上限を言い渡すだけで半分以下になり、**遅い側のばらつきも抑えられる**。
 */
export const DISCOVERY_DEPTHS = ["quick", "thorough"] as const;
export type DiscoveryDepth = (typeof DISCOVERY_DEPTHS)[number];
export const DEFAULT_DISCOVERY_DEPTH: DiscoveryDepth = "quick";

export const DISCOVERY_DEPTH_LABELS: Record<DiscoveryDepth, { label: string; note: string }> = {
  quick: { label: "さっくり", note: "15〜30秒" },
  thorough: { label: "しっかり", note: "40秒〜2分" },
};

/** AIが返した1件を、位置の確認と既存スポットとの突き合わせを済ませた形 */
export interface DiscoveryCandidate {
  name: string;
  name_kana: string | null;
  /** AIが答えた住所(都道府県から)。位置の確認に使い、画面にもそのまま出す */
  address: string | null;
  /** spots.regionに入れる地域(都道府県/州・県/国)。解決できなければnull(画面で選ばせる) */
  region: string | null;
  lat: number;
  lng: number;
  /** 業態・ジャンル(「ラーメン」「カフェ」など)。追加時はカテゴリに入れる */
  genre: string | null;
  /** AIによる一言の要約(口コミの転記ではなく、AI自身の言葉) */
  summary: string | null;
  /** AIが提案したランク(A〜E)。追加前にフォームで直せる */
  rank: Rank | null;
  rank_reason: string | null;
  /** 参照元のURL。無い候補は根拠が確かめられないので薄く出す */
  url: string | null;
  /**
   * 店名+住所の地名検索で中心から半径内に当たり、その座標に置き換えたらtrue。
   * falseのときの座標はAIの答えのままで「未確認」
   */
  location_verified: boolean;
  /** 中心からの距離(m)。半径の外に出た候補に気づけるように出す */
  distance_m: number;
  /** 既存スポット(公開・承認待ち)と名前一致か近接していればその1件 */
  existing: { id: string; name: string } | null;
}

/**
 * AIとの1往復の中身。**画面から見られるようにしてある** —— 何を頼んで何が返ったかが
 * 分からないと、遅い・少ない・的外れの原因を切り分けられない(プロンプトを直すのも、
 * 相手を替えるのも、この2つを見てから決める)。`source: "ai"`のときだけ入る
 */
export interface DiscoveryExchange {
  system: string;
  user: string;
  /** 相手が返した生の文字列(JSONを取り出す前) */
  response: string;
  /** 問い合わせにかかった時間(ミリ秒) */
  elapsed_ms: number;
}

export interface DiscoveryResult {
  candidates: DiscoveryCandidate[];
  /** この結果の出どころ(行の印と、画面の言い回しに使う) */
  source: DiscoverySource;
  /** 実際に答えた相手とモデル(`ai`のときだけ。説明文には書かないが画面で確かめられる) */
  backend: string | null;
  model: string | null;
  /** 探索した日時(ISO 8601)。説明文の「AIがwebから収集(日付)」に使う */
  searched_at: string;
  /** 中心座標から引いた地域。候補側で地域が取れなかったときの既定 */
  center_region: string | null;
  /** AIとのやり取り(`source: "ai"`のときだけ)。画面の「やり取りを見る」で出す */
  exchange?: DiscoveryExchange;
}

/** `YYYY-MM-DD`(JST)。人が読む説明文に入れるので、実行環境のTZに依らせない */
export function formatJstDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())}`;
}

/**
 * 候補からスポットの説明文を組む。AIの要約のあとに、出どころ(AIがwebから収集した
 * 日付と参照URL)を必ず添える —— 手で書いた説明と見分けられるようにするため。
 * 口コミ本文や点数はプロンプトで転記を禁じているので、ここには入らない
 */
export function buildDiscoveredDescription(
  candidate: Pick<DiscoveryCandidate, "summary" | "url" | "location_verified">,
  searchedAt: string,
  source: DiscoverySource
): string {
  const lines: string[] = [];
  if (candidate.summary?.trim()) lines.push(candidate.summary.trim());
  // **出どころは必ず添える** —— 手で書いた説明と見分けるため。
  // OSM由来のときはODbLのデータであることが分かる書き方にする
  const provenance =
    source === "osm"
      ? [`OpenStreetMapから取得(${formatJstDate(searchedAt)})`]
      : [`AIがwebから収集(${formatJstDate(searchedAt)})`];
  if (candidate.url) provenance.push(`参照: ${candidate.url}`);
  if (source === "ai" && !candidate.location_verified) provenance.push("位置は未確認");
  lines.push(provenance.join("、"));
  return lines.join("\n\n");
}

/** 2点間の距離(m)。半径内の判定と重複判定に使う(球面近似で十分) */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** 名前の突き合わせ用に正規化する(全角半角・空白・記号の違いで別物にしない) */
export function normalizeSpotName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　・･\-‐‑–—―~〜()()[\]【】「」『』]/g, "");
}
