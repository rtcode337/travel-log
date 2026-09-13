import type { SpotType } from "./types";
import type { DiscoveryBackend, DiscoveryResult } from "./spotDiscovery";

/**
 * 「情報を集めさせる」層の、travel-log側の決まりごと。
 * **サーバー専用ではない**(管理画面も収集名と既定のプロンプトを出すため読む)。
 *
 * 周辺を探す(`lib/spotDiscovery.ts`)との違いは**時間の扱い**。あちらはその場で
 * 探して数十秒で返すので、探せる範囲も精度も1回の待ち時間で頭打ちになる。
 * こちらは知識サーバー(chiezo)へ**依頼だけして離れ**、集まった頃に取り出す ——
 * 待たない代わりに、じっくり集めたものを受け取れる。
 *
 * **溜め先はスポット種別ごとに1つ**(chiezoの「収集」= 1ソース)。種別ごとに
 * 集めるものが違い、プロンプトも別々に育てるため。
 *
 * **依頼しても勝手には走らない。** chiezoは外から作られた収集を必ず止めた状態で置き、
 * 有効にできるのはあちらの管理画面だけ(REST から `enabled` は触れない)。
 * こちらの画面は、止まっている間はその旨を出して「有効にしてください」と促す。
 */

/** 収集名・プロンプトを持つ設定のキー(`spot_type_settings`。値は文字列) */
export const COLLECT_SOURCE_SETTING_KEY = "collect_source";
export const COLLECT_PROMPT_SETTING_KEY = "collect_prompt";

/**
 * 依頼するときの間隔(分)。**数時間に1回**。
 *
 * 1回あたりを長く・広く取り、**周回で精度を上げる**使い方に合わせてある ——
 * 1回で薄く10件ずつ拾っても全国は埋まらないし、間隔を詰めても知識サーバーは
 * 同時に1本しか走らせない(混んでいれば断られるだけ)。
 *
 * 全国を市区町村で舐める規模(約1,700)を3時間ごとに1つずつでは200日を超えるので、
 * **1回で広い範囲を扱わせる**のがこの間隔の前提(プロンプト側の仕事)。
 * 足りなければ画面の「いま集める」で予定を待たずに起こせる。
 */
export const COLLECT_INTERVAL_MINUTES = 180;

/**
 * 取り出す件数の上限。**取り出しの位置(カーソル)は覚えない** ——
 * 覚えると、画面を閉じただけ・別の端末で開いただけで取りこぼす。毎回新しい順に
 * この数だけ取り、追加済みのものは「登録済み」の印で分かるようにする。
 */
export const COLLECT_FETCH_LIMIT = 50;

/**
 * 収集の起点(`collect_origin`)。**travel-log側で差し込む** ——
 * `{cursor}`と`{covered}`は知識サーバーが解決するが、起点はあちらの知らない概念なので、
 * 依頼を保存するときにこちらが文字列へ置き換えてから渡す。
 */
export const COLLECT_ORIGIN_SETTING_KEY = "collect_origin";
export const COLLECT_ORIGIN_PLACEHOLDER = "{origin}";

/**
 * 種別キーから収集名を作る。**chiezoの制約は「英小文字で始まる2〜31文字
 * (英小文字・数字・`_`)」**なので、そこへ収まる形に均す。
 *
 * 接頭辞を付けるのは、chiezo側の一覧で**どのアプリが依頼したものか**が名前だけで
 * 分かるようにするため(`requested_by`は有効にするか決める人への印であって、
 * ソース名として引くときには出てこない)。
 *
 * 実際に使う名前は種別の設定に持つ(`COLLECT_SOURCE_SETTING_KEY`)—— キーを
 * 変えても、いちど依頼した収集を指し続けられるように。
 */
export function defaultCollectSourceName(typeKey: string): string {
  const body = typeKey
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+/, "");
  return `tl_${body}`.slice(0, 31).replace(/_+$/, "");
}

/** その種別が使う収集名(未設定なら種別キーから作る) */
export function resolveCollectSource(
  type: Pick<SpotType, "key" | "settings"> | null | undefined
): string {
  const raw = type?.settings?.[COLLECT_SOURCE_SETTING_KEY]?.trim();
  return raw || defaultCollectSourceName(type?.key ?? "");
}

/** chiezoが受け取れる収集名か(向こうと同じ規則。依頼する前にこちらで断る) */
export function isValidCollectSource(name: string): boolean {
  return /^[a-z][a-z0-9_]{1,30}$/.test(name);
}

/**
 * 依頼するときの既定のプロンプト。**画面で書き換える前提の下書き**で、
 * 種別の名前だけを差し込む。
 *
 * **返す形をここで決め切る。** 集まったものからスポットを起こすのはこちら側なので、
 * 名前・所在地・一言・出典が1件ずつ揃っていないと取り出せない ——
 * とくに**所在地は座標を引き当てる手掛かり**で、これが無いと同名の別の場所を掴む。
 * 座標そのものは書かせない(AIの座標は当てにならないので、こちらで地図辞典から引く)。
 */
export function defaultCollectPrompt(typeLabel: string): string {
  return [
    `日本の「${typeLabel}」を、市区町村を1つずつ回りながら集める。`,
    "",
    "起点: {origin}",
    "今回の範囲: {cursor}",
    "{covered}",
    "",
    `今回の範囲にある「${typeLabel}」を挙げる。`,
    "**件数は指定しない。その範囲にあるものを、拾えるだけ拾う。**",
    "**時間を掛けてよい。** 1件ずつ実在と所在地を確かめる。",
    "",
    "**手元の知識サーバー(chiezoのMCP)を必ず使う。** web検索より先にこちらを引く ——",
    "レート制限が無く、地物は実在が確かめられているものだけが入っている。",
    "",
    "- 候補を洗い出す: `filter` で `overture_japan`(301万件)や `osm_japan`(155万件)を",
    "  bbox と種別で引く。名前と座標がそのまま取れる",
    "- 知名度と説明: `search` / `doc` で `jawiki`(151万件)を引く。",
    "  `extra.pageviews_month` が月間の閲覧数なので、**有名な順を機械的に決められる**",
    "- 実在と所在地の確認: 挙げる前に地図辞典に在るかを引く。",
    "  **辞典に無いものは、webで裏が取れたものだけ入れる**(新しい店はよくある)",
    "",
    "**辞典に在るものを全部並べるのではない。** 辞典は「在るもの」しか知らないので、",
    "記録する価値があるか(名物・老舗・その土地ならでは)を選ぶのはこちらの仕事。",
    "",
    "**進み方:**",
    "",
    "- 今回の範囲を**拾い切れていないと感じたら、next_cursor に同じ範囲を入れる**。",
    "  次回も同じところを続けて掘る。拾い切ったと思えたときだけ次へ進む",
    "- 拾い切ったときは covered にその範囲を入れ、next_cursor には**起点にいちばん近い、",
    "  まだ回っていない市区町村**を入れる。**遠くへ飛ばない** ——",
    "  起点から外へ、同心円を広げるように埋めていく",
    "- 起点の周りを回り終えたら、そこから順に外側へ広げる",
    "",
    "title はスポットの名前だけ(店名・施設名。地域や説明を混ぜない)。",
    "body は1行目に「所在地: 都道府県 市区町村 まで」、2行目以降に2〜3文の紹介。",
    "tags はジャンルを1〜2個。url は出典。",
    "",
    "実在すると確信できるものだけを入れる。所在地が特定できないものは入れない。",
    "covered と next_cursor は「東京都新宿区」の形で書く。",
  ].join("\n");
}

/**
 * 円が跨いでいる地域を調べるために突くところ。**中心と円周の8方位**。
 *
 * 円の中を隙間なく確かめることはできない(地図辞典は地物の点しか持たず、
 * 市区町村の形は持っていない)ので、**代表点で見る**。中心だけでは、円が境界を
 * 跨いでいるときに隣の市区町村を見落とす —— 「円の中のすべてで取り終わっているか」
 * を聞かれている以上、跨ぎを拾えないと答えにならない。
 *
 * 8方位なのは、市区町村が円より大きいのが普通だから。これ以上増やしても
 * 同じ地域を何度も引くだけで、突くたびに知識サーバーへの問い合わせが増える。
 */
export function areaProbePoints(
  center: { lat: number; lng: number },
  radiusM: number
): { lat: number; lng: number }[] {
  const latPerM = 1 / 111_320;
  const lngPerM = 1 / (111_320 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.01));
  const points = [center];
  for (let i = 0; i < 8; i += 1) {
    const t = (i / 8) * Math.PI * 2;
    points.push({
      lat: center.lat + Math.sin(t) * radiusM * latPerM,
      lng: center.lng + Math.cos(t) * radiusM * lngPerM,
    });
  }
  return points;
}

/** 円の中の地域が、収集済みかどうか */
export interface CollectCoverage {
  /** 円が跨いでいる地域(「東京都新宿区」の形) */
  areas: string[];
  /** そのうち回り終えているもの */
  covered: string[];
  /** まだ回り終えていないもの */
  missing: string[];
}

/**
 * 取り出した結果。円を指定したときだけ、その円の収集の進み具合(`coverage`)が付く。
 *
 * **`DiscoveryResult`をそのまま広げる** —— 周辺を探すのパネルに同じ器で載せるので、
 * 候補の形は変えられない。円の話だけを外側に足す。
 */
export interface CollectCandidatesResult extends DiscoveryResult {
  coverage: CollectCoverage | null;
}

/** 集めた文書1件(chiezoの`recent`が返す形のうち、こちらが読むぶん) */
export interface CollectedDoc {
  title: string;
  body: string;
  tags: string[];
  url: string | null;
  updatedAt: string | null;
}

/**
 * 本文から「所在地: …」を取り出す。**書式に厳しくしない** —— 相手はAIなので
 * `所在地:`・`場所:`・`住所:`のどれで来ても拾い、**行頭でなくても拾う**
 * (溜めたものを1段落に均した`opening`しか取れないこともあり、そこでは改行が落ちる)。
 * 見つからなければ本文の頭を返す(そこに地名が入っていることが多い)。
 */
export function parseCollectedArea(body: string): string | null {
  const m = /(?:所在地|場所|住所)\s*[:：]\s*([^\n。]{2,60})/.exec(body);
  if (m?.[1]?.trim()) return m[1].trim();
  const head = body.split("\n")[0]?.trim();
  return head ? head.slice(0, 60) : null;
}

/** 所在地の行を除いた紹介文(スポットの説明に使う) */
export function parseCollectedSummary(body: string): string | null {
  const rest = body
    .split("\n")
    .filter((line) => !/^\s*(?:所在地|場所|住所)\s*[:：]/.test(line))
    .join("\n")
    .trim();
  return rest || body.trim() || null;
}

/** chiezoの収集1件(こちらが読むぶんだけ)。管理画面が状態を出すのに使う */
export interface ChiezoCollection {
  name: string;
  description?: string;
  prompt?: string;
  interval_minutes?: number;
  enabled?: boolean;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  requested_by?: string;
  /** 次に集める地域(知識サーバーの「次はどこ」の印)。空ならAIが決める */
  cursor?: string;
  /** 誰に・どのモデルで・どこまで考えさせるか。空なら知識サーバーの既定 */
  backend?: string | null;
  model?: string | null;
  effort?: string | null;
  /** 回り終えた地域。**1件ぶんの口でしか返らない**(一覧は件数だけ) */
  covered?: string[];
  covered_count?: number;
}

/** いま知識サーバーで取り込み(=収集)が走っているか */
export interface ChiezoIngestStatus {
  state: string;
  running: boolean;
  source: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface SpotCollectStatus {
  /** この環境・この種別・この権限で使えるか(3つ揃って初めてtrue) */
  available: boolean;
  /** 溜め先の収集名(chiezoのソース名) */
  source: string;
  /** いまのプロンプト(未設定なら種別名から作った下書き。`{origin}`は未置換) */
  prompt: string;
  /** 収集の起点。ここから外へ広げる(空ならAIが決める) */
  origin: string;
  /** まだ依頼していなければnull */
  collection: ChiezoCollection | null;
  /**
   * いま知識サーバーで取り込みが走っているか。**押す前に判断できるように出す** ——
   * あちらは同時に1本しか受けないので、走っている間に頼んでも断られる
   */
  ingest: ChiezoIngestStatus | null;
  /**
   * 選べる相手・モデル・深さ(周辺を探すと同じ口から配る)。
   * **深さは効く** —— 指定しないと浅い既定で走り、1都道府県を3分で切り上げた
   */
  backends: DiscoveryBackend[];
}
