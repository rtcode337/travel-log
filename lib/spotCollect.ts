import type { SpotType } from "./types";

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
 * 依頼するときの間隔(分)。**実質オンデマンドにするために長く置く**。
 *
 * chiezoの収集は間隔が必須(最小5分)で「手動のみ」が無いので、こちらの使い方
 * (レポートのように、欲しくなったときに1回起こす)に合わせるには長い値を入れて
 * 予定のほうを事実上使わない形にするしかない。起こすのは「いま集める」のほう。
 */
export const COLLECT_INTERVAL_MINUTES = 60 * 24 * 30;

/**
 * 取り出す件数の上限。**取り出しの位置(カーソル)は覚えない** ——
 * 覚えると、画面を閉じただけ・別の端末で開いただけで取りこぼす。毎回新しい順に
 * この数だけ取り、追加済みのものは「登録済み」の印で分かるようにする。
 */
export const COLLECT_FETCH_LIMIT = 50;

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
    `{cursor} 以降に見つけた「${typeLabel}」を10件、新しい順に。`,
    "既に有名で定着しているものより、最近できた・最近話題になったものを優先する。",
    "",
    "title はスポットの名前だけ(店名・施設名。地域や説明を混ぜない)。",
    "body は1行目に「所在地: 都道府県 市区町村 まで」、2行目以降に2〜3文の紹介。",
    "tags はジャンルを1〜2個。url は出典。",
    "",
    "実在すると確信できるものだけを入れる。所在地が特定できないものは入れない。",
    "next_cursor には、いちばん新しい話題の日付を YYYY-MM-DD で入れる。",
  ].join("\n");
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
}

export interface SpotCollectStatus {
  /** この環境・この種別・この権限で使えるか(3つ揃って初めてtrue) */
  available: boolean;
  /** 溜め先の収集名(chiezoのソース名) */
  source: string;
  /** いまのプロンプト(未設定なら種別名から作った下書き) */
  prompt: string;
  /** まだ依頼していなければnull */
  collection: ChiezoCollection | null;
}
