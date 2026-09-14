import type { SpotType } from "./types";
import type { DiscoveryBackend, DiscoveryResult } from "./spotDiscovery";

/**
 * 「情報を集めさせる」層の、travel-log側の決まりごと。
 * **サーバー専用ではない**(管理画面も同じ定数を読む)。
 *
 * 周辺を探す(`lib/spotDiscovery.ts`)との違いは**時間の扱い**。あちらはその場で
 * 探して数十秒で返すので、探せる範囲も精度も1回の待ち時間で頭打ちになる。
 * こちらは知識サーバー(chiezo)へ**依頼だけして離れ**、集まった頃に取り出す。
 *
 * ## 網羅(`kind: "stock"`)で回す
 *
 * **1本のカーソルでは「一周した」が言えない。** かつては`{cursor}`に次の市区町村を
 * AIに書かせ、`{covered}`に回り終えた地名を積む形だったが、取りこぼしがどこかも、
 * 全国を舐め終わったかも分からなかった(全国約1,700市区町村を数時間に1つでは
 * 200日を超える)。しかも収集済みの判定が**AIの書いた地名の表記**に依存していて、
 * 「東京都新宿区」と「新宿区」の揺れを吸う処理が要った。
 *
 * いまは**区画**(`partition`)で回す。chiezoが対象の空間を矩形に割り、巡回が
 * 順に配る —— 区画は数え上げられるので「一周した」が言え、進み具合も矩形なので
 * 表記の揺れが入り込む余地が無い。
 *
 * **割るのは対象としている空間であって、集まったものではない。** 母集団は
 * 地図辞典(`overture_japan`・`osm_japan`)を指す —— こちらが1件も持っていなくても、
 * あちらは北海道にも店があることを知っている。**k-d treeで密度分割する**ので、
 * 都市部は細かく地方は粗く、かつ全域に区画ができる。
 *
 * ## 巡回は3本
 *
 * | 巡回 | 時計 | やること |
 * |---|---|---|
 * | 名簿 | 週1・機械 | 抽出条件で地図辞典から名簿を引き直す(AIを呼ばない) |
 * | ざっと | 6時間・3日で一周 | 全区画を舐めて精査・整理する |
 * | じっくり | 12時間・7日で一周 | 1区画ずつ詳しく調べる。**ざっとが一周するまで走らない** |
 *
 * **じっくりがざっとを待つ**(`after`)のは、名簿を作った直後に詳細を聞いても
 * 「もう入っているもの」を並べて終わるため —— 区画の中身が一度行き渡っていないと、
 * 何が足りないのかを判断する材料が無い。
 *
 * ## 割り込みは「じっくり」の枠で走らせる
 *
 * **割り込み専用の巡回は置かない。** 頼むのは同じ仕事(疑う・直す・足りないものを足す)
 * なので、設定も依頼文もじっくりのものでよい —— 別に持つと、じっくりのプロンプトを
 * 育てても割り込みは古い文で走る。
 *
 * 頼み方は2つあり、**どちらも`POST /v1/collect/{name}/focus`**:
 *
 * | 渡すもの | 使いどころ |
 * |---|---|
 * | `titles` | **この1件を直して**(間違い報告のあったスポット) |
 * | `partition` | **この範囲を先に見て**(地図で見ている区画) |
 *
 * **名指しできることが要**。区画を渡すだけでは、直してほしい1件が差し込みに載る
 * 保証がない(その区画の中身が多ければ、途中で切られる)。
 *
 * **`run`ではなく`focus`なのは、定時の巡回に影響を出さないため。** `run`は予定も
 * 区画の巡回記録も進めるので、割り込むたびに一周が伸びたり、見ていない区画に
 * 印が付いたりする。`focus`はそこを動かさない(動くのは中身だけ)。
 *
 * ## 抽出条件とプロンプトはAIが書く
 *
 * **集めたい軸は種別ごとに違う**(ラーメン店・神社・駅・道の駅…)ので、どのソースの
 * どのタグを引くかも、どう調べさせるかも決め打ちにできない。chiezoの
 * `draft-extract`(抽出条件)と`draft`(プロンプト)に**ふつうの言葉**を渡して書かせ、
 * 引いた件数と先頭数件を見てから依頼する。
 *
 * **正はchiezo側**。プロンプトが2本・抽出条件・区画と増えたので、こちらへ写すと
 * どちらが正か決められなくなる。こちらに残すのは収集名だけ(種別キーを変えても、
 * いちど依頼した収集を指し続けられるように)。
 */

/** 収集名を持つ設定のキー(`spot_type_settings`)。**これだけがこちら側** */
export const COLLECT_SOURCE_SETTING_KEY = "collect_source";

/**
 * 市区町村カーソル方式だった頃の設定。**依頼し直すときに掃除する** ——
 * 読む側が消えたので残っていても効かないが、設定の一覧に出ると
 * 「まだ使っている」と読めてしまう。
 */
export const RETIRED_COLLECT_SETTING_KEYS = ["collect_prompt", "collect_origin"];

/**
 * 対象にする範囲。**日本全体**で、書かないと母集団の外接矩形になる ——
 * 点のあるところしか区画にならないので、「まだ何も無い範囲」が対象から落ちる。
 * 地図辞典が日本の抽出なので、この機能自体が日本の種別向け。
 * `[南緯, 西経, 北緯, 東経]`(chiezoの順)。
 */
export const JAPAN_BBOX: [number, number, number, number] = [20.2, 122.5, 45.8, 154.0];

/**
 * 目指す区画の数。
 *
 * **一周の日数から逆算した上限で決まっている。** chiezoは1回に見る区画を20までに
 * 制限するので(`MAX_PARTITIONS_PER_RUN`)、6時間ごと3日=12回なら240区画が上限。
 * ざっともじっくりもこの数に収まるよう、母集団の件数から`target`を決める。
 * これより多い区画になる種別では一周が静かに延びる(止まりはしない)。
 */
export const PARTITION_GOAL = 200;

/** 1区画あたりの目安。chiezo側の許容は10〜5,000 */
const MIN_PARTITION_TARGET = 10;
const MAX_PARTITION_TARGET = 5_000;

/**
 * 母集団の件数から、1区画あたりの目安を決める。
 * **区画数をだいたい`PARTITION_GOAL`に保つ**ための逆算。
 */
export function partitionTarget(population: number): number {
  if (!Number.isFinite(population) || population <= 0) return MIN_PARTITION_TARGET;
  const target = Math.ceil(population / PARTITION_GOAL);
  return Math.min(Math.max(target, MIN_PARTITION_TARGET), MAX_PARTITION_TARGET);
}

/** 巡回の名前。**区画の巡回記録は名前で引かれる**ので、変えると進み具合が切れる */
export const SWEEP_ROSTER = "名簿";
export const SWEEP_SCAN = "ざっと";
export const SWEEP_DEEP = "じっくり";

/** 一周にかける日数。**区画が増えても1回あたりをchiezoが計算し直す** */
export const SCAN_COVER_DAYS = 3;
export const DEEP_COVER_DAYS = 7;

/** 巡回ごとの時計(分) */
const ROSTER_INTERVAL_MINUTES = 60 * 24 * 7;
const SCAN_INTERVAL_MINUTES = 60 * 6;
const DEEP_INTERVAL_MINUTES = 60 * 12;

/** 相手・モデル・深さ。**空文字は「指定しない」** */
export interface CollectChoice {
  backend?: string;
  model?: string;
  effort?: string;
}

/**
 * 巡回3本を組む。**プロンプトは2本しか要らない** ——
 * 名簿は機械で引く回(`use_extract`)なのでプロンプトを使わない。
 * **割り込み専用の巡回は作らない**(じっくりの枠で走らせる。上の説明を参照)。
 */
export function buildSweeps(args: {
  deepPrompt: string;
  choice?: CollectChoice;
}): Record<string, unknown>[] {
  const pick = (v?: string) => (v?.trim() ? v.trim() : undefined);
  const choice = {
    backend: pick(args.choice?.backend),
    model: pick(args.choice?.model),
    effort: pick(args.choice?.effort),
  };
  return [
    {
      name: SWEEP_ROSTER,
      interval_minutes: ROSTER_INTERVAL_MINUTES,
      // **機械で引く回**。地図辞典に店が増えても名簿へ入るようにする ——
      // 機械で埋まるのが「1回目だけ」だと、そのあと増えたぶんは永遠に入らない
      use_extract: true,
      // **足すだけ**。名簿は名前と所在地しか持たないので、AIが肉付けしたぶんを
      // 上書きさせない(組にしないと、調べた内容が薄い名簿で潰れる)
      only_new: true,
      partitions_per_run: 1,
    },
    {
      name: SWEEP_SCAN,
      interval_minutes: SCAN_INTERVAL_MINUTES,
      cover_days: SCAN_COVER_DAYS,
      ...choice,
    },
    {
      name: SWEEP_DEEP,
      prompt: args.deepPrompt,
      interval_minutes: DEEP_INTERVAL_MINUTES,
      cover_days: DEEP_COVER_DAYS,
      // **ざっとが一周してから始める。** 区画の中身が行き渡っていないと、
      // 詳しく調べる回が「もう入っているもの」を並べて終わる
      after: SWEEP_SCAN,
      ...choice,
      // 詳細調査は深く考えさせる(指定が無ければ相手の既定)
      effort: pick(args.choice?.effort) ?? "high",
    },
  ];
}

/** chiezoが受け取る抽出の指定(こちらは中身を組み立てず、AIが書いたものを通すだけ) */
export interface CollectExtract {
  source: string;
  tag?: string;
  tag_suffix?: string;
  not_tag?: string;
  limit?: number | null;
  body?: string;
  url?: string;
  tags?: unknown[];
  cursor?: string;
}

/**
 * 抽出条件から区画の指定を作る。
 *
 * **母集団は抽出元と同じソース**で、絞り込みは**抽出条件の最初のタグ**を使う ——
 * chiezoの区画はタグを1つしか受け取らない(抽出は`,`で並べられる)。
 * 並びの2つめ以降が落ちても、**bboxを日本全体で明示してある**ので全域に区画はできる。
 * タグは「どこを細かく割るか」にしか効かないため、これで足りる。
 *
 * **タグの無い抽出条件では割れない。** ソース全体は50万点の上限を超えるので、
 * chiezoが409で断る —— 黙って広い区画を作るより、依頼文を絞り直させるほうがよい。
 *
 * **件数が分からないときは`target`を書かない**(chiezoの既定=200に任せる)。
 * 0件として逆算すると最小の10になり、区画が膨れ上がる。
 */
export function buildPartition(
  extract: CollectExtract,
  target?: number
): Record<string, unknown> {
  const firstTag = (extract.tag ?? "").split(",")[0]?.trim();
  return {
    by: "geo",
    source: extract.source,
    ...(firstTag ? { tag: firstTag } : {}),
    bbox: JAPAN_BBOX,
    ...(target ? { target } : {}),
  };
}

/**
 * 「じっくり」の既定のプロンプト。**こちらが持つ**。
 *
 * 種別ごとに違うのは**何を集めるか**であって、**どう疑うか**ではない ——
 * 詳しく調べる回に確かめてほしいのは「その場所は実在するか」「所在地は合っているか」
 * 「同じ場所が二重に入っていないか」で、これはラーメン店でも神社でも駅でも同じ。
 * だからここだけはAIに書かせず、種別名を差し込む定型にしてある
 * (AIの呼び出しが1回減るぶん、依頼までの待ち時間も短い)。
 */
export function defaultDeepPrompt(typeLabel: string): string {
  return [
    `「${typeLabel}」の一覧を見直してください。**この回は、入っている内容を疑う回**です。`,
    "",
    "**今回見る範囲**",
    "{partition}",
    "",
    "{current}",
    "",
    "上に並んでいるものを1件ずつ確かめてください。",
    "",
    `**これは「${typeLabel}」か。** 名簿は地図辞典のカテゴリから機械的に作っているので、`,
    "分類の粗いもの・閉店したもの・そもそも別のものが混ざります。",
    "当てはまらないものは墓標で消してください(tags に \"削除\" を入れて返す)。",
    "",
    "**所在地は合っているか。** 本文1行目の「所在地: 都道府県 市区町村」を確かめてください。",
    "**ここが後で座標を引き当てる手掛かり**なので、間違っていると同名の別の場所を掴みます。",
    "確かめられなかったものは触らないでください —— 疑わしいから消す、をやると、",
    "正しかったものまで落ちます。",
    "",
    "**同じ場所が2つに分かれていないか。** 表記の揺れ(支店の名乗り・英字の別名)で",
    "二重になっていたら、残すほうに中身をまとめて返し、消すほうに墓標を付けてください。",
    "",
    "**この範囲に足りないものがあれば足してください。** 名簿は地図辞典に載っているものが",
    "元なので、**新しい店・小さい店・地図に無いものは入っていません**。",
    "webで調べて、確信が持てるものだけを挙げてください。",
    "",
    "**直すものと足すものだけ返してください。** 触れなかったものはそのまま残ります。",
    "1件の形は次のとおりです。",
    "- title: 名前だけ(店名・施設名。地域や説明を混ぜない)",
    "- body: 1行目に「所在地: 都道府県 市区町村 まで」、2行目以降に2〜3文の紹介",
    "- url: 出典",
    "- tags: ジャンルを1〜2個。**いま付いているタグは、直すもの以外そのまま残してください**",
    "  (返した内容で丸ごと置き換わるので、書かなかったタグは消えます)",
  ].join("\n");
}

/**
 * 抽出条件をAIに書かせるときの依頼文。**種別の名前だけを差し込む下書き**で、
 * 画面で書き換えてから投げる。
 */
export function defaultExtractWant(typeLabel: string): string {
  return [
    `日本の「${typeLabel}」の名簿を、地図辞典から機械的に作りたい。`,
    "",
    "引く先は overture_japan(店舗・施設が301万件。カテゴリがタグに入っている)か",
    "osm_japan(地名・施設・交通インフラが155万件。主タグが feature に入っている)。",
    "どちらがこの軸に向いているかを選んでほしい。",
    "",
    "title は名前だけ、body は opening でよい。",
    `tags には「${typeLabel}」を固定で1つ付けたうえで、ジャンルが読み取れるなら足す。`,
  ].join("\n");
}

/**
 * 「ざっと」のプロンプトをAIに書かせるときの依頼文。
 * **区画を回る収集であることを必ず書く** —— 書かないと`{partition}`の無い、
 * 範囲をAIに決めさせる指示文が返ってくる。
 */
export function defaultScanWant(typeLabel: string, extractSource: string): string {
  return [
    `日本の「${typeLabel}」を、区画を1つずつ回りながら精査する収集。`,
    "**端から端まで舐めていく網羅の収集なので、{partition} と {current} を必ず入れること。**",
    "範囲の選び方をAIに決めさせてはいけない(Chiezoが区画を配る)。",
    "",
    `名簿は地図辞典(${extractSource})から機械的に作ってあり、名前と所在地しか入っていない。`,
    "この回にやってほしいのは、その範囲に並んでいるものを順に精査すること ——",
    `当てはまらないものを外し、ジャンルを付け直し、「${typeLabel}」として記録する価値が`,
    "あるかを見る。",
    "",
    "**手元の知識サーバー(chiezoのMCP)を必ず使う。** web検索より先にこちらを引く。",
    "レート制限が無く、地物は実在が確かめられているものだけが入っている。",
    "",
    "1件の形:",
    "- title: 名前だけ(店名・施設名。地域や説明を混ぜない)",
    "- body: 1行目に「所在地: 都道府県 市区町村 まで」、2行目以降に2〜3文の紹介",
    "- url: 出典",
    "- tags: ジャンルを1〜2個",
    "",
    "**座標は書かせない**(AIの座標は当てにならないので、こちらで地図辞典から引く)。",
    "所在地が特定できないものは入れない。",
  ].join("\n");
}

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

/* ---- 区画 ------------------------------------------------------------------ */

/** 区画1つぶん(chiezoの`partitions`)。`visits`は巡回名 → 最後に見た日時 */
export interface ChiezoPartition {
  key: string;
  count: number;
  visits?: Record<string, string>;
}

/** 区画の鍵(`緯度,経度/緯度,経度`)を矩形に戻す。読めなければnull */
export function parseGeoKey(
  key: string
): { south: number; west: number; north: number; east: number } | null {
  const [head, tail] = key.split("/");
  if (!head || !tail) return null;
  const [south, west] = head.split(",").map(Number);
  const [north, east] = tail.split(",").map(Number);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  return { south, west, north, east };
}

/** 円の中の収集の進み具合 */
export interface CollectCoverage {
  /** 円に重なる区画の数 */
  total: number;
  /** そのうち「ざっと」が一度でも見たもの */
  scanned: number;
  /** そのうち「じっくり」が一度でも見たもの */
  deep: number;
  /** まだ「ざっと」が見ていない区画の鍵。**いま集めるに渡す** */
  pending: string[];
}

/** 円に重なる区画を渡すときの上限(画面に出すのも、頼めるのも先頭だけ) */
const MAX_PENDING_PARTITIONS = 8;

/**
 * 円に重なる区画を数えて、進み具合を返す。
 *
 * **判定は矩形と円の距離で行う**(円の外接矩形との重なりでは、角のぶんを
 * 収集済みに数えてしまう)。地名の突き合わせが要らなくなったのがこの方式の要で、
 * かつては円周8方位を突いて市区町村を引き、表記の揺れを吸っていた。
 */
export function partitionCoverage(
  center: { lat: number; lng: number },
  radiusM: number,
  partitions: ChiezoPartition[]
): CollectCoverage {
  const latPerM = 1 / 111_320;
  const lngPerM =
    1 / (111_320 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.01));
  const dLat = radiusM * latPerM;
  const dLng = radiusM * lngPerM;
  let total = 0;
  let scanned = 0;
  let deep = 0;
  const pending: string[] = [];
  for (const part of partitions) {
    const box = parseGeoKey(part.key);
    if (!box) continue;
    // 矩形の中で中心にいちばん近い点。緯度・経度それぞれを円の半径で割って正規化する
    // (経度は緯度によって長さが変わるので、メートルに直してから比べるのと同じこと)
    const nx = (Math.min(Math.max(center.lat, box.south), box.north) - center.lat) / dLat;
    const ny = (Math.min(Math.max(center.lng, box.west), box.east) - center.lng) / dLng;
    if (nx * nx + ny * ny > 1) continue;
    total += 1;
    const visits = part.visits ?? {};
    if (visits[SWEEP_SCAN]) scanned += 1;
    else if (pending.length < MAX_PENDING_PARTITIONS) pending.push(part.key);
    if (visits[SWEEP_DEEP]) deep += 1;
  }
  return { total, scanned, deep, pending };
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

/** 巡回1本ぶん(こちらが読むぶんだけ) */
export interface ChiezoSweep {
  name: string;
  interval_minutes?: number;
  enabled?: boolean;
  cover_days?: number | null;
  partitions_per_run?: number | null;
  on_demand?: boolean;
  use_extract?: boolean;
  after?: string;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  /** 区画をいくつ見終わったか(chiezoが数えて返す) */
  partitions_visited?: number;
  next_partition?: string | null;
}

/** chiezoの収集1件(こちらが読むぶんだけ)。管理画面が状態を出すのに使う */
export interface ChiezoCollection {
  name: string;
  description?: string;
  prompt?: string;
  interval_minutes?: number;
  enabled?: boolean;
  last_status?: string | null;
  last_error?: string | null;
  requested_by?: string;
  backend?: string | null;
  model?: string | null;
  effort?: string | null;
  kind?: string | null;
  extract?: CollectExtract | null;
  partition?: Record<string, unknown> | null;
  partitions?: ChiezoPartition[];
  sweeps?: ChiezoSweep[];
}

/** いま知識サーバーで取り込み(=収集)が走っているか */
export interface ChiezoIngestStatus {
  state: string;
  running: boolean;
  source: string | null;
  started_at: string | null;
  finished_at: string | null;
}

/**
 * AIが書いた抽出条件の下書き(`draft-extract`の答え)。
 * **その場で引いた件数と先頭数件が付く** —— タグは完全一致でしか引けないので、
 * それらしい名前を書かれると静かな0件になる。
 */
export interface CollectExtractDraft {
  extract: CollectExtract | null;
  /** 機械では引けないと判断されたときの理由 */
  reason?: string;
  /** ソース全体の件数と、条件に当たった件数 */
  total: number;
  matched: number;
  sample: { title: string; body?: string; tags?: string[] }[];
  /** 0件のときにchiezoが返す、実在するタグ名の候補 */
  candidates?: { tag: string; docs?: number }[];
}

/** 一周の進み具合(画面に出すぶん)。`total`が0なら区画がまだ割られていない */
export interface CollectLap {
  name: string;
  total: number;
  visited: number;
}

export interface SpotCollectStatus {
  /** この環境・この種別・この権限で使えるか(3つ揃って初めてtrue) */
  available: boolean;
  /** 溜め先の収集名(chiezoのソース名) */
  source: string;
  /** まだ依頼していなければnull */
  collection: ChiezoCollection | null;
  /** 区画の総数と、巡回ごとの進み具合 */
  partitionCount: number;
  laps: CollectLap[];
  /**
   * いま知識サーバーで取り込みが走っているか。**押す前に判断できるように出す** ——
   * あちらは同時に1本しか受けないので、走っている間に頼んでも断られる
   */
  ingest: ChiezoIngestStatus | null;
  /** 選べる相手・モデル・深さ(周辺を探すと同じ口から配る) */
  backends: DiscoveryBackend[];
  /** 依頼していないときの下書き(画面の初期値) */
  draftExtractWant: string;
  draftScanWant: string;
  defaultDeepPrompt: string;
}
