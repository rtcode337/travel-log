import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  PREFECTURES,
  SPOT_ADMIN_ROLES,
  getSpotTypeSetting,
  type SpotType,
} from "@/lib/types";
import { SPOT_TYPE_SELECT } from "@/lib/spot-types-query";
import { resolveRegionScope } from "@/lib/region";
import { parseRank, type Rank } from "@/lib/rank";
import {
  DISCOVERY_DUPLICATE_DISTANCE_M,
  DISCOVERY_RADIUS_OPTIONS,
  MAX_DISCOVERY_CANDIDATES,
  DEFAULT_DISCOVERY_DEPTH,
  DISCOVERY_DEPTHS,
  MAX_DISCOVERY_QUERY_LENGTH,
  distanceMeters,
  looksLikeSameSpot,
  mapLookupQueries,
  normalizeSpotName,
  type DiscoveryBackend,
  type DiscoveryCandidate,
  type DiscoveryDepth,
  type DiscoveryOptions,
  type DiscoveryResult,
} from "@/lib/spotDiscovery";
import {
  DEFAULT_DISCOVERY_EFFORT,
  defaultDiscoveryBackend,
  discoveryBaseUrl,
  fetchDiscoveryBackends,
  resolveDiscoveryChoice,
} from "@/lib/aiDiscoveryConfig";
import { bboxAround } from "@/lib/osmNearby";

/**
 * 地図の周辺を検索語でAIに調べさせ、スポットの候補を返す(spot_admin/admin専用)。
 *
 * **なぜAIに調べさせるか。** 飲食店のような「新しい店がよく入れ替わる」種別は、
 * 商用のAPI(グルメサイト・地図サービス)が自前DBへの保存と再配布を禁じているため
 * 出どころにできず、地図データは開いたばかりの店が載らない。
 * そこでweb検索を持つAIに周辺を調べさせ、機械的に決めにくいランク付けまで任せる。
 *
 * **AIへの中継は知識サーバー(chiezo)の`/v1/ai/complete`。** 鍵はあちらが握っていて
 * このアプリは持たない。接続先は`CHIEZO_BASE_URL`で、未設定ならこの機能は出ない
 * (GETが`enabled: false`を返し、画面はメニュー項目を出さない。POSTは503)。
 * **相手・モデル・深さ(effort)は探索の画面で選ぶ**(GETが選択肢を配り、POSTが
 * 受け取って確かめる)。その場の目的で軽くも重くもしたい設定なので、管理画面で
 * 全員ぶんを1つに決める形にはしていない。選ばれなければ`CHIEZO_AI_BACKEND`か既定に落ちる。
 * **種別ごとに`ai_discovery_enabled`で開ける**(既定off。AIの枠を使うので、
 * 使う種別だけ明示的に開ける)。
 *
 * **速さを優先する。** 「近くの昼食を探す」ような使い方が主なので、
 * 正確さより早く出ることを採る。効いたのは3つ(実測: 3分超 → 30秒台):
 * ①プロンプトを短くし、頼む項目を必要な最小限にする、②モデルとeffortを
 * 管理画面から選べるようにして軽い設定で回す、③位置の確認をローカル(chiezo)だけにし、
 * **候補ごとにNominatimを叩かない**(1秒1回の間隔制限があり、10件で10秒以上かかっていた)。
 *
 * **AIの答えは信用せず、こちらで確かめてから出す。**
 * - 位置: chiezoの地図辞典(`overture_japan`→`osm_japan`の順。ローカルで数ms、レート制限が無いので**並列に**引く)を
 *   店名+半径のbboxで引き、当たればその座標に置き換えて「位置確認済み」。
 *   当たらなければAIの座標のまま「未確認」の印(開いたばかりの店は地図データに無いのが普通なので、
 *   未確認は珍しくない。地図で見て違えば追加後に「位置を修正」で直す)
 * - 重複: 同じ種別の公開・承認待ちスポットと名前一致か50m以内なら「登録済み」の印
 * - 出どころ: 参照URLの無い候補はそのまま返す(画面が薄く出す)。口コミ本文や点数の
 *   転記はプロンプトで禁じ、説明文はAI自身の要約だけにする
 *
 * **探索の結果は保存しない。** 画面で選んで追加したものだけが通常のPOST `/api/spots`
 * (`origin='manual'`)で入る。
 */

// AIの答えを待つぶん、既定(10秒)では足りない
// (Vercelのサーバーレス関数の上限。指定の無いホストでは無視される)
export const maxDuration = 300;

/**
 * AIの答えを待つ上限(秒)。**短くしてある** —— 待たされた末に失敗するより、
 * 早く諦めて条件を変えて出し直せるほうがよい(実測では30〜100秒で返る)。
 * 長い調査に使いたい環境は`CHIEZO_AI_TIMEOUT_SECONDS`で伸ばせる
 */
const DEFAULT_AI_TIMEOUT_SECONDS = 180;

/** Nominatimへ連続で投げない間隔。利用ポリシーが1秒に1回まで(中心の地域を引く1回のみ) */
const NOMINATIM_INTERVAL_MS = 1100;

/** chiezoの1問い合わせの上限。あちらは5秒でクエリを切るので、それより少し長く */
const CHIEZO_LOOKUP_TIMEOUT_MS = 8_000;

/**
 * 位置の当たりを「半径内」とみなす余裕。AIは半径ぴったりで区切らないので、
 * 少し外でも同じ店なら位置確認済みにする
 */
const VERIFY_RADIUS_FACTOR = 1.5;

const USER_AGENT = "travel-log-personal-app/1.0";

function aiTimeoutMs(): number {
  const seconds = Number(process.env.CHIEZO_AI_TIMEOUT_SECONDS);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_AI_TIMEOUT_SECONDS) * 1000;
}

async function loadSpotType(request: Request): Promise<SpotType | null> {
  const typeKey = new URL(request.url).searchParams.get("type");
  if (!typeKey) return null;
  const { rows } = await query<SpotType>(`${SPOT_TYPE_SELECT} where t.key = $1`, [typeKey]);
  return rows[0] ?? null;
}

/**
 * 探索の画面が読む状態(接続先そのものは返さない)。
 * `enabled`は「この環境に接続先がある」「この種別で開けている」「呼んだ人が管理者」の
 * 3つがそろって初めてtrue。あわせて**画面で選ぶための選択肢**(いま話せる相手と、
 * その相手で選べるモデル・深さ)も配る
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const baseUrl = discoveryBaseUrl();
  const spotType = await loadSpotType(request);
  const enabled =
    !!baseUrl &&
    SPOT_ADMIN_ROLES.includes(user.role) &&
    !!spotType &&
    getSpotTypeSetting(spotType, "ai_discovery_enabled");

  let backends: DiscoveryBackend[] = [];
  let error: string | null = null;
  if (enabled && baseUrl) {
    try {
      // web検索を持たない相手は探索に使えない(chiezoが400で断る)ので、最初から出さない
      backends = (await fetchDiscoveryBackends(baseUrl)).filter((b) => b.web);
    } catch (err) {
      error = err instanceof Error ? err.message : "AI中継サーバーに接続できませんでした。";
    }
  }
  const options: DiscoveryOptions = {
    enabled,
    backends,
    defaultBackend: defaultDiscoveryBackend(),
    defaultEffort: DEFAULT_DISCOVERY_EFFORT,
    error,
  };
  return NextResponse.json({ data: options });
}

// ---- 位置の確認(chiezoの地図辞典。並列に引く) ----

interface Point {
  lat: number;
  lng: number;
}

interface ChiezoSearchResponse {
  results?: { title?: unknown }[];
}

interface ChiezoDocResponse {
  title?: unknown;
  extra?: {
    lat?: unknown;
    lon?: unknown;
    area?: unknown;
    /** Overture側にはURL・電話・住所が入っている(OSMは tags 側なのでここでは見ない) */
    website?: unknown;
    address?: unknown;
    locality?: unknown;
  };
}

/** 地図辞典で見つかった1件。位置だけでなく**確かめられた事実**を持ち帰る */
interface MapMatch {
  point: Point;
  /** 地図側の見出し(画面には出さない。突き合わせの確認用) */
  title: string;
  /** 公式サイト。AIが答えたURLより優先する(出どころが辿れるため) */
  website: string | null;
  /** 地図側の住所。日本語のときだけ使う(Overtureはローマ字表記が混ざる) */
  address: string | null;
}

interface ChiezoFilterResponse {
  results?: { extra?: { area?: unknown } }[];
}

/** chiezoへのGET。落ちていても探索を止めないので、失敗はnullで返す */
async function chiezoGet<T>(baseUrl: string, path: string, params: URLSearchParams): Promise<T | null> {
  try {
    const res = await fetch(`${baseUrl}${path}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(CHIEZO_LOOKUP_TIMEOUT_MS),
    });
    // 504は「0件」ではなく「取れなかった」。呼び出し側はNominatimへ落ちる
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * chiezoの地図辞典で店名を半径内から探し、当たった地物の正確な座標を返す。
 * 検索の応答には座標が載らない(snippetに4桁までの文字があるだけ)ので、
 * 当たった題名で`doc`を引き直す。どちらもローカルで数msなので2往復してよい。
 *
 * **Overtureを先に見る**。AIが挙げるのは新しい店・話題の店が多く、そこがいちばん
 * OSMの穴と重なる(実測: AIが挙げた有名店4件のうちOSMで引けたのは1件)。
 * Overtureは日本で301万件あってOSMの倍近い。当たらなければOSMへ落ちる ——
 * 寺社や公園のように、Overture側の分類が薄いものはOSMのほうが確実。
 */
async function verifyWithChiezo(
  baseUrl: string,
  name: string,
  center: Point,
  radiusM: number
): Promise<MapMatch | null> {
  const bbox = bboxAround(center, radiusM * VERIFY_RADIUS_FACTOR);
  const sources = ["overture_japan", "osm_japan"] as const;
  // **問い合わせ語を段階的に緩める**(`mapLookupQueries`)。生の名前だけで引くと、
  // 実在する店を「確認できなかった」と扱ってしまう。緩めるぶんは`looksLikeSameSpot`で
  // 別の店を掴まないよう歯止めをかける
  for (const q of mapLookupQueries(name)) {
    const founds = await Promise.all(
      sources.map((source) =>
        chiezoGet<ChiezoSearchResponse>(
          baseUrl,
          `/v1/${source}/search`,
          new URLSearchParams({ q, limit: "5", bbox })
        )
      )
    );
    for (const [i, source] of sources.entries()) {
      for (const hit of founds[i]?.results ?? []) {
        if (typeof hit.title !== "string") continue;
        if (!looksLikeSameSpot(name, hit.title)) continue;
        const doc = await chiezoGet<ChiezoDocResponse>(
          baseUrl,
          `/v1/${source}/doc`,
          new URLSearchParams({ title: hit.title, fields: "title,extra" })
        );
        const lat = Number(doc?.extra?.lat);
        const lng = Number(doc?.extra?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const text = (v: unknown) =>
          typeof v === "string" && v.trim() ? v.trim() : null;
        const address = text(doc?.extra?.address);
        return {
          point: { lat, lng },
          title: hit.title,
          website: text(doc?.extra?.website),
          // ローマ字の住所(`1 Chome-6-3 Kabukicho`)はAIの日本語の答えより読みにくい
          address: address && /[぀-ヿ一-鿿]/.test(address) ? address : null,
        };
      }
    }
  }
  return null;
}

/**
 * 中心座標の都道府県をchiezoのOSM辞典から引く(近くの地物の`area`)。無ければnull。
 * **ここだけはOSM** —— Overtureの`area`はJISのコードで、しかも日本ではほぼ空
 */
async function regionWithChiezo(baseUrl: string, center: Point): Promise<string | null> {
  // 中心のすぐ近くに地物が無いこともあるので、狭い枠から広げて2回まで見る
  for (const radius of [100, 1000]) {
    const found = await chiezoGet<ChiezoFilterResponse>(
      baseUrl,
      "/v1/osm_japan/filter",
      new URLSearchParams({ bbox: bboxAround(center, radius), limit: "1", fields: "title,extra" })
    );
    const area = found?.results?.[0]?.extra?.area;
    if (typeof area === "string" && (PREFECTURES as readonly string[]).includes(area)) return area;
  }
  return null;
}

let nominatimChain: Promise<unknown> = Promise.resolve();
let lastNominatimAt = 0;

/**
 * Nominatim(geocode/reverseのルートと同じ相手)。間隔を空けて直列に叩く。
 * **使うのは中心の地域を引く1回だけ** —— 候補ごとに叩いていた頃は、1秒1回の
 * 間隔制限がそのまま待ち時間になっていた(10件で10秒以上)
 */
async function nominatim<T>(path: string, params: URLSearchParams): Promise<T | null> {
  const run = async (): Promise<T | null> => {
    const wait = NOMINATIM_INTERVAL_MS - (Date.now() - lastNominatimAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimAt = Date.now();
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/${path}?${params}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  };
  const queued = nominatimChain.then(run, run);
  // 失敗しても鎖を切らない(次の呼び出しが投げられなくなるため)
  nominatimChain = queued.catch(() => undefined);
  return queued;
}

interface NominatimReverseHit {
  address?: {
    country?: string;
    state?: string;
    province?: string;
    county?: string;
    "ISO3166-2-lvl4"?: string;
  };
}

/** 中心座標の地域(都道府県/州・県/国)をNominatimで引く。geocode/reverseと同じ解決順 */
async function regionWithNominatim(center: Point, scope: string): Promise<string | null> {
  const hit = await nominatim<NominatimReverseHit>(
    "reverse",
    new URLSearchParams({
      lat: String(center.lat),
      lon: String(center.lng),
      format: "json",
      "accept-language": "ja",
      zoom: "10",
    })
  );
  const address = hit?.address;
  if (!address) return null;
  if (scope === "jp") {
    const match = address["ISO3166-2-lvl4"]?.match(/^JP-(\d{2})$/);
    if (match) return PREFECTURES[Number(match[1]) - 1] ?? null;
    return address.state ?? address.province ?? null;
  }
  if (scope === "world") return address.country ?? null;
  return address.state ?? address.province ?? address.county ?? null;
}

/**
 * 候補の位置を確かめる。**chiezoの地図辞典だけ**を引く(ローカルで数ms、
 * レート制限が無いので候補ぶんを並列に投げられる)。当たらなければnull =
 * AIの座標のまま「未確認」。
 * かつてはここでNominatimにも聞いていたが、1秒1回の間隔制限がそのまま待ちになり、
 * しかもchiezoに無い店(=新店)は同じOSM由来のNominatimにも無いことが多く、
 * 待った割に当たらなかった。日本以外のスコープは`osm_japan`の外なので常に未確認になる
 */
async function verifyLocation(
  baseUrl: string,
  candidate: { name: string },
  center: Point,
  radiusM: number,
  scope: string
): Promise<MapMatch | null> {
  if (scope !== "jp") return null;
  return verifyWithChiezo(baseUrl, candidate.name, center, radiusM);
}

// ---- AIへの問いかけ ----

/**
 * 役割の指示。**`quick`では「webの検索は多くても2回」と言い渡す**のが要点 ——
 * エージェントとして動く相手は、放っておくと候補ごとに裏取りの検索を回して
 * 時間を使う。上限を切るだけで実測41秒→17秒になった(同じ相手・同じ件数)。
 */
function buildSystemPrompt(depth: DiscoveryDepth): string {
  if (depth === "quick") {
    return [
      "周辺の店を手早く挙げる。**webの検索は多くても2回**。1回の検索で分かる範囲で答え、裏取りに時間をかけない。",
      "**実在すると確信できる店だけ**を挙げる。名前・場所があやふやなものは数合わせに入れず、件数が足りなくてもそのまま返す。",
      "**指定された半径の外は入れない。**",
      "口コミの本文・点数・順位は書き写さない。",
      "出力はJSONの配列だけ。前置き・説明・コードブロックの記号は付けない。",
    ].join("\n");
  }
  return [
    "実在の場所をweb検索で確かめて探す調査員。閉店・移転が疑われる場所は含めない。",
    "口コミの本文・点数・順位は書き写さない。要約は自分の言葉で短く。",
    "出力はJSONの配列だけ。前置き・説明・コードブロックの記号は付けない。",
  ].join("\n");
}

/**
 * 頼む項目は**必要な最小限**にする。項目を1つ増やすと候補の数だけ文が増え、
 * そのぶん待たされる。落としたものと理由:
 * - `region`(都道府県): 中心座標から自分で引ける(半径数kmで県をまたいでも中心の県でよい)
 * - `name_kana`(よみがな): 無くても登録でき、後から直せる
 * - `rank_reason`: ランクの根拠。ランクは数字1文字で足りる
 * - `rank`: **その種別がランクを使うときだけ**聞く(使わない種別では捨てるだけの項目)
 *
 * `quick`では**URLも必須にしない** —— 1件ずつ根拠のページを当たらせると、
 * そのぶん検索が増えて遅くなる(参照URLの無い候補は画面が薄く出す)。
 */
function buildUserPrompt(
  center: Point,
  radiusM: number,
  searchQuery: string,
  limit: number,
  withRank: boolean,
  depth: DiscoveryDepth
): string {
  const quick = depth === "quick";
  const shape = [
    '"name":"店名"',
    quick ? '"address":"住所か目印"' : '"address":"住所"',
    '"lat":35.6,"lng":139.7',
    '"genre":"ジャンル"',
    quick ? '"summary":"一言"' : '"summary":"一言(1文)"',
    quick ? '"url":"分かればURL(なければnull)"' : '"url":"根拠にしたページのURL"',
    ...(withRank ? ['"rank":"A〜Eの1文字(知名度)"'] : []),
  ].join(",");
  const head = quick
    ? `緯度${center.lat.toFixed(5)} 経度${center.lng.toFixed(5)} から半径${radiusM}mの「${searchQuery}」を${limit}件。`
    : `緯度${center.lat.toFixed(5)} 経度${center.lng.toFixed(5)} から半径${radiusM}mの「${searchQuery}」を最大${limit}件。`;
  return [
    head,
    `JSON配列で: [{${shape}}]`,
    quick
      ? "分からない値はnull。近い順。"
      : "分からない値はnull。中心から近い順。半径の外は含めない。該当が無ければ []。",
  ].join("\n");
}

interface ChiezoCompleteResponse {
  backend?: string;
  model?: string | null;
  content?: string;
  /** 失敗時。`reason`に相手側の事情(「空の答えが返った」等)が入ることがある */
  error?: string;
  reason?: string;
  /** FastAPIのHTTPExceptionはこの形で包んで返す */
  detail?: { error?: string; reason?: string } | string;
}

/** chiezoのエラー本文から人に見せる一文を組む(形が2通りあるので両方見る) */
function chiezoErrorDetail(body: ChiezoCompleteResponse | null): string | null {
  if (!body) return null;
  const inner = typeof body.detail === "object" && body.detail ? body.detail : body;
  const parts = [inner.error, inner.reason].filter(
    (s): s is string => typeof s === "string" && s.trim() !== ""
  );
  if (parts.length === 0 && typeof body.detail === "string") parts.push(body.detail);
  return parts.length > 0 ? parts.join(": ") : null;
}

/** chiezoの`/v1/ai/complete`へ1往復投げる。失敗はErrorで返す(呼び出し側が文言にする) */
async function askAi(
  baseUrl: string,
  settings: { backend: string; model: string | null; effort: string | null },
  messages: { role: "system" | "user"; content: string }[]
): Promise<{ content: string; backend: string; model: string | null; elapsedMs: number }> {
  const timeoutMs = aiTimeoutMs();
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/ai/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({
        backend: settings.backend,
        // 未選択のときは送らない(相手の既定に任せる)
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.effort ? { effort: settings.effort } : {}),
        messages,
        web: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new Error(
      timedOut
        ? `${settings.backend} が${Math.round(timeoutMs / 1000)}秒以内に答えませんでした。件数を減らすか、管理画面で軽いモデル・低いeffortを選んでください。`
        : "AI中継サーバーに接続できませんでした(接続先が動いているか確かめてください)。"
    );
  }
  const body = (await res.json().catch(() => null)) as ChiezoCompleteResponse | null;
  if (!res.ok || !body?.content) {
    const detail = chiezoErrorDetail(body);
    // 相手の名前を必ず出す(どの相手が失敗したのかが分からないと切り替えられない)
    throw new Error(
      `${settings.backend} が答えられませんでした(${res.status}${detail ? `: ${detail}` : ""})。` +
        "管理画面の「周辺をAIで探す」で別の相手に切り替えられます。"
    );
  }
  return {
    content: body.content,
    backend: body.backend ?? settings.backend,
    model: body.model ?? null,
    elapsedMs: Date.now() - startedAt,
  };
}

/** AIの答えからJSON配列を取り出す。コードブロックや前置きが混じっても拾えるようにする */
function extractCandidateArray(content: string): unknown[] | null {
  const stripped = content.replace(/```(?:json)?/gi, "").trim();
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(stripped.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

interface RawCandidate {
  name: string;
  name_kana: string | null;
  address: string | null;
  region: string | null;
  lat: number;
  lng: number;
  genre: string | null;
  summary: string | null;
  rank: Rank | null;
  rank_reason: string | null;
  url: string | null;
}

function str(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** 参照URLはhttp(s)だけを通す(説明文にそのまま書くので、変なスキームを持ち込ませない) */
function httpUrl(value: unknown): string | null {
  const s = str(value, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** AIの答えの1要素を検証して型に寄せる。名前か座標が無いものは捨てる */
function toRawCandidate(value: unknown): RawCandidate | null {
  if (typeof value !== "object" || value === null) return null;
  const o = value as Record<string, unknown>;
  const name = str(o.name, 200);
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    name,
    name_kana: str(o.name_kana, 200),
    address: str(o.address, 300),
    region: str(o.region, 100),
    lat,
    lng,
    genre: str(o.genre, 50),
    summary: str(o.summary, 500),
    rank: parseRank(o.rank),
    rank_reason: str(o.rank_reason, 300),
    url: httpUrl(o.url),
  };
}

/** 地域の値がその種別で使える形か('jp'は既知の都道府県名だけを通す) */
function acceptableRegion(region: string | null, scope: string): string | null {
  if (!region) return null;
  if (scope === "jp") {
    return (PREFECTURES as readonly string[]).includes(region) ? region : null;
  }
  return region;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!SPOT_ADMIN_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }
  const baseUrl = discoveryBaseUrl();
  if (!baseUrl) {
    return NextResponse.json(
      { error: "この環境ではAIによる周辺探索を利用できません(CHIEZO_BASE_URL未設定)。" },
      { status: 503 }
    );
  }

  const spotType = await loadSpotType(request);
  if (!spotType) {
    return NextResponse.json({ error: "存在しない種別です。" }, { status: 404 });
  }
  if (!getSpotTypeSetting(spotType, "ai_discovery_enabled")) {
    return NextResponse.json(
      { error: "この種別では周辺のAI探索が無効です(管理画面の種別の設定で有効にできます)。" },
      { status: 403 }
    );
  }
  const scope = resolveRegionScope(spotType);

  const body = (await request.json().catch(() => null)) as {
    lat?: unknown;
    lng?: unknown;
    radius?: unknown;
    query?: unknown;
    limit?: unknown;
    backend?: unknown;
    model?: unknown;
    effort?: unknown;
    depth?: unknown;
  } | null;
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  const radius = Number(body?.radius);
  const searchQuery = str(body?.query, MAX_DISCOVERY_QUERY_LENGTH);
  const limitRaw = Number(body?.limit);
  const limit = Number.isInteger(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_DISCOVERY_CANDIDATES)
    : 10;
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return NextResponse.json({ error: "lat, lng is required" }, { status: 400 });
  }
  if (!(DISCOVERY_RADIUS_OPTIONS as readonly number[]).includes(radius)) {
    return NextResponse.json({ error: "invalid radius" }, { status: 400 });
  }
  if (!searchQuery) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  const center: Point = { lat, lng };
  // 念の入れ方。おかしな値は既定(さっくり)に寄せる
  const depth: DiscoveryDepth = (DISCOVERY_DEPTHS as readonly string[]).includes(
    String(body?.depth)
  )
    ? (body?.depth as DiscoveryDepth)
    : DEFAULT_DISCOVERY_DEPTH;
  // ランクを使わない種別ではランクを聞かない(捨てる項目のぶんだけ待たされるため)
  const withRank = getSpotTypeSetting(spotType, "rank_enabled");

  // 画面で選ばれた相手・モデル・深さを確かめる。**選択肢の取得に失敗しても止めない**
  // (確かめられないことを理由に探索そのものを断らない)
  const backends = await fetchDiscoveryBackends(baseUrl).catch(() => []);
  const pick = (value: unknown) => (typeof value === "string" ? value : null);
  const resolved = resolveDiscoveryChoice(backends, {
    backend: pick(body?.backend),
    model: pick(body?.model),
    effort: pick(body?.effort),
  });
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }
  const settings = resolved;

  // AIの答えを待つ間に、中心の地域と既存スポットは先に引いておける
  const searchedAt = new Date().toISOString();
  const centerRegionPromise = (async () =>
    (scope === "jp" ? await regionWithChiezo(baseUrl, center) : null) ??
    (await regionWithNominatim(center, scope)))();
  // 既存スポットは半径の2倍の矩形で粗く取り、突き合わせは距離で行う
  const latPad = (radius * 2) / 111_000;
  const lngPad = (radius * 2) / (111_000 * Math.max(Math.cos((lat * Math.PI) / 180), 0.1));
  const existingPromise = query<{ id: string; name: string; lat: number; lng: number }>(
    `select id, name, lat, lng from spots
     where spot_type_id = $1 and status in ('published', 'pending')
       and lat between $2 and $3 and lng between $4 and $5`,
    [spotType.id, lat - latPad, lat + latPad, lng - lngPad, lng + lngPad]
  );

  // 画面の「やり取りを見る」で出すので、投げた本文はここで組んで取っておく
  const systemPrompt = buildSystemPrompt(depth);
  const userPrompt = buildUserPrompt(center, radius, searchQuery, limit, withRank, depth);

  let answer: Awaited<ReturnType<typeof askAi>>;
  try {
    answer = await askAi(baseUrl, settings, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AIへの問い合わせに失敗しました。" },
      { status: 502 }
    );
  }

  const exchange = {
    system: systemPrompt,
    user: userPrompt,
    response: answer.content,
    elapsed_ms: answer.elapsedMs,
  };

  const array = extractCandidateArray(answer.content);
  if (!array) {
    // **読み取れなかったときこそ中身が要る**(何が返ったか見ないと直しようがない)
    return NextResponse.json(
      {
        error:
          "AIの答えをJSONとして読み取れませんでした。返ってきた本文: " +
          answer.content.slice(0, 300),
      },
      { status: 502 }
    );
  }
  const raws = array
    .map(toRawCandidate)
    .filter((c): c is RawCandidate => c !== null)
    .slice(0, limit);

  const [centerRegion, { rows: existingSpots }] = await Promise.all([
    centerRegionPromise,
    existingPromise,
  ]);
  const existingByName = new Map(
    existingSpots.map((s) => [normalizeSpotName(s.name), s] as const)
  );

  // 位置の確認は**並列**に投げる(chiezoはローカルでレート制限が無い)。
  // 直列に1件ずつ待っていた頃は、件数がそのまま待ち時間に乗っていた
  const matches = await Promise.all(
    raws.map((raw) => verifyLocation(baseUrl, raw, center, radius, scope))
  );

  const candidates: DiscoveryCandidate[] = raws.map((raw, i) => {
    const verified = matches[i];
    const position = verified?.point ?? { lat: raw.lat, lng: raw.lng };
    const existing =
      existingByName.get(normalizeSpotName(raw.name)) ??
      existingSpots.find(
        (s) => distanceMeters(position, s) <= DISCOVERY_DUPLICATE_DISTANCE_M
      ) ??
      null;
    return {
      name: raw.name,
      // よみがなとランクの根拠はAIに聞かない(項目を増やすと待ちが延びる)
      name_kana: null,
      // **確かめられた住所があればそちらを使う**(AIの住所は確かめる相手がいない)。
      // 地図側がローマ字表記のときはnullで返るので、その場合はAIの答えを残す
      address: verified?.address ?? raw.address,
      // 地域はAIに聞かず、中心座標から引いたものを全候補に使う
      // (半径は数kmまでなので、中心の県で足りる)
      region: centerRegion,
      lat: position.lat,
      lng: position.lng,
      genre: raw.genre,
      summary: raw.summary,
      rank: raw.rank,
      rank_reason: null,
      // **地図データの公式サイトを優先する**。AIが答えたURLは確かめる相手がいないが、
      // こちらは実在を確かめた地物に紐づいている。実測では`quick`のAIは
      // URLを1件も返さない一方、地図側は10件中9件で持っていた ——
      // 根拠が無いように見えていた候補のほとんどに、実は出どころがあった
      url: verified?.website ?? raw.url,
      location_verified: verified !== null,
      distance_m: Math.round(distanceMeters(center, position)),
      // 地図データではないので辞典は無い(説明文は「AIがwebから収集」になる)
      dataset: null,
      existing: existing ? { id: existing.id, name: existing.name } : null,
    };
  });

  const result: DiscoveryResult = {
    candidates,
    source: "ai",
    backend: answer.backend,
    model: answer.model,
    searched_at: searchedAt,
    center_region: centerRegion,
    exchange,
  };
  return NextResponse.json({ data: result });
}
