import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { PREFECTURES, type Spot } from "@/lib/types";
import { resolveRegionScope } from "@/lib/region";
import { addressOf } from "@/lib/osmNearby";
import {
  DISCOVERY_DUPLICATE_DISTANCE_M,
  distanceMeters,
  looksLikeSameSpot,
  mapLookupQueries,
  normalizeSpotName,
  type DiscoveryCandidate,
  type DiscoveryResult,
} from "@/lib/spotDiscovery";
import {
  COLLECT_FETCH_LIMIT,
  parseCollectedArea,
  parseCollectedSummary,
  type CollectedDoc,
} from "@/lib/spotCollect";
import {
  partitionCoverage,
  type CollectCandidatesResult,
} from "@/lib/spotCollect";
import {
  chiezo,
  fetchCollection,
  resolveCollectContext,
} from "@/lib/spotCollectServer";
import { prefectureFromAreaCode } from "@/lib/overtureNearby";
import { bboxAround } from "@/lib/osmNearby";

/**
 * 溜まった収集から**スポットの候補を取り出す**(spot_admin/admin専用)。
 *
 * **取り出しの位置(カーソル)は覚えない。** 毎回いちばん新しいものから
 * `COLLECT_FETCH_LIMIT`件を取り、既に追加したものは「登録済み」の印で分かるようにする
 * —— 覚えると、画面を閉じただけ・別の端末で開いただけで取りこぼす。
 *
 * **座標はAIに書かせず、地図辞典から引き直す**(周辺を探すと同じ流儀)。集めた文書に
 * 書いてあるのは名前と所在地までで、そこから`overture_japan`→`osm_japan`を引いて
 * 座標・住所・公式サイトを取る。**引き当てられなくても候補としては返す**
 * (「地図データに無い」の印が付く)—— 開いたばかりの店は辞典に載っていないのが普通で、
 * そこを落とすと、この機能で拾いたいものがちょうど落ちる。
 */

// 候補ぶん地図辞典を引くので、既定(10秒)では足りない
export const maxDuration = 120;

const USER_AGENT = "travel-log-personal-app/1.0";
const CHIEZO_LOOKUP_TIMEOUT_MS = 8_000;

interface ChiezoRecentResponse {
  /** **`results`ではなく`docs`**(chiezoの`recent`だけ鍵が違う。実測で確認) */
  docs?: {
    title?: unknown;
    body?: unknown;
    opening?: unknown;
    tags?: unknown;
    extra?: { url?: unknown; web?: unknown } | null;
    updated_at?: unknown;
  }[];
}

interface ChiezoSearchResponse {
  results?: { title?: unknown }[];
}

interface ChiezoFilterResponse {
  results?: { extra?: { area?: unknown; locality?: unknown } | null }[];
}

/** 1点の所在(都道府県と市区町村)。どちらも取れないことがある */
interface PointArea {
  prefecture: string | null;
  municipality: string;
}

/**
 * 市区町村らしい名前か。**屑を弾く** —— `locality`には`Tokyo`のような
 * 英字の広い地名も入っていて、そのまま地域として扱うと同じ場所が二重に数えられる。
 */
function looksLikeMunicipality(value: string): boolean {
  return /[市区町村]$/.test(value) && /[぀-ヿ一-鿿]/.test(value);
}

/**
 * その1点がどの地域かを地図辞典から引く。**辞典を2つとも引く**:
 *
 * - 市区町村は **Overtureの`locality`**(OSMは持っていない)
 * - 都道府県は **OSMの`area`** —— Overtureの`area`はJISのコードで、
 *   しかも**日本ではほぼ空**(このリポジトリが繰り返し踏んでいるところ)。
 *   実測でも、同じ円の中で「東京都新宿区」と「新宿区」が混ざって出た
 *
 * 地物が1つも無い点(海の上・山の中)はnull —— そこは収集の対象でもない。
 */
async function areaAt(
  baseUrl: string,
  point: { lat: number; lng: number }
): Promise<PointArea | null> {
  // 近くに地物が無いこともあるので、狭い枠から広げて2回まで見る
  for (const radius of [400, 3000]) {
    const bbox = bboxAround(point, radius);
    const [overture, osm] = await Promise.all([
      chiezoGet<ChiezoFilterResponse>(
        baseUrl,
        "/v1/overture_japan/filter",
        new URLSearchParams({ bbox, limit: "30", fields: "title,extra" })
      ),
      chiezoGet<ChiezoFilterResponse>(
        baseUrl,
        "/v1/osm_japan/filter",
        new URLSearchParams({ bbox, limit: "30", fields: "title,extra" })
      ),
    ]);
    // **いちばん多いものを採る。** 先頭1件だと、境界のすぐ内側にある隣の
    // 市区町村の地物を掴んで、点がそちらに居ることになる
    const municipality = mostCommon(
      (overture?.results ?? [])
        .map((r) => str(r.extra?.locality, 60))
        .filter((v): v is string => !!v && looksLikeMunicipality(v))
    );
    if (!municipality) continue;
    const prefecture =
      mostCommon(
        (osm?.results ?? [])
          .map((r) => str(r.extra?.area, 60))
          .filter((v): v is string => !!v && (PREFECTURES as readonly string[]).includes(v))
      ) ??
      // OSM側が空でも、Overtureにコードが入っていれば拾える(たまに入っている)
      mostCommon(
        (overture?.results ?? [])
          .map((r) => prefectureFromAreaCode(str(r.extra?.area, 10)))
          .filter((v): v is string => !!v)
      );
    return { prefecture, municipality };
  }
  return null;
}

/** いちばん多く出た値。無ければnull */
function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}

/**
 * 円の中が収集済みかは、**区画の巡回記録で見る**(`partitionCoverage`)。
 * かつては円周8方位を突いて市区町村を引き、回り終えた印(AIが書いた地名)と
 * 突き合わせていたが、「東京都新宿区」と「新宿区」の揺れを吸う処理が要った。
 * 区画は矩形なので、そこに表記の入り込む余地が無い。
 *
 * 中心の地域(`areaAt`)はいまも引く —— **座標を引き当てられなかった候補**が
 * 円の中の話かを見るのに要る(新しい店は地図辞典に載っていないのが普通で、
 * そこを落とすとこの機能で拾いたいものがちょうど落ちる)。
 */

interface ChiezoDocResponse {
  title?: unknown;
  extra?: {
    lat?: unknown;
    lon?: unknown;
    /** 都道府県。OSMは名前が入るが、**Overtureはほぼ空**(JISのコードのため) */
    area?: unknown;
    /** 市区町村。**Overtureで所在地を突き合わせられる唯一の欄**になることが多い */
    locality?: unknown;
    address?: unknown;
    website?: unknown;
    /** OSMのタグ束(住所は`addr:*`に散っている) */
    tags?: Record<string, unknown>;
  } | null;
}

const str = (v: unknown, max = 2000): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

async function chiezoGet<T>(
  baseUrl: string,
  path: string,
  params: URLSearchParams
): Promise<T | null> {
  try {
    const res = await fetch(`${baseUrl}${path}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(CHIEZO_LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** 集めた文書1件を、こちらが読む形に均す */
function toDoc(raw: NonNullable<ChiezoRecentResponse["docs"]>[number]): CollectedDoc | null {
  const title = str(raw.title, 200);
  if (!title) return null;
  return {
    title,
    body: str(raw.body) ?? str(raw.opening) ?? "",
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === "string")
      : [],
    url: str(raw.extra?.url, 500),
    updatedAt: str(raw.updated_at, 40),
  };
}

/** 地図辞典で当たった1件 */
interface MapMatch {
  lat: number;
  lng: number;
  region: string | null;
  address: string | null;
  website: string | null;
}

/**
 * 名前と所在地から地図辞典を引く。**bboxで絞れない**のがここの難しさ ——
 * 周辺を探すと違って中心が無いので、全国から引くことになる。同名の別の店を
 * 掴まないよう、歯止めを2つ掛ける:
 *
 * 1. `looksLikeSameSpot`(周辺を探すと同じ。正規化した名前が互いを含むこと)
 * 2. **所在地との突き合わせ** —— 集めた文書に書かれた都道府県・市区町村が、
 *    地物の`area`か住所に出てくること。全国に同名の店がある業態ではここだけが頼り
 */
async function lookupOnMap(
  baseUrl: string,
  name: string,
  area: string | null
): Promise<MapMatch | null> {
  const sources = ["overture_japan", "osm_japan"] as const;
  for (const q of mapLookupQueries(name)) {
    const founds = await Promise.all(
      sources.map((source) =>
        chiezoGet<ChiezoSearchResponse>(
          baseUrl,
          `/v1/${source}/search`,
          new URLSearchParams({ q, limit: "8" })
        )
      )
    );
    for (const [i, source] of sources.entries()) {
      for (const hit of founds[i]?.results ?? []) {
        const title = str(hit.title, 200);
        if (!title || !looksLikeSameSpot(name, title)) continue;
        const doc = await chiezoGet<ChiezoDocResponse>(
          baseUrl,
          `/v1/${source}/doc`,
          new URLSearchParams({ title, fields: "title,extra" })
        );
        const lat = Number(doc?.extra?.lat);
        const lng = Number(doc?.extra?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const docArea = str(doc?.extra?.area, 60);
        const locality = str(doc?.extra?.locality, 60);
        // 住所はOvertureが`address`に平らに持ち、OSMは`addr:*`のタグに散っている
        const address =
          str(doc?.extra?.address, 200) ?? addressOf(doc?.extra?.tags ?? {});
        if (!matchesArea(area, [docArea, locality, address])) continue;
        return {
          lat,
          lng,
          region:
            docArea && (PREFECTURES as readonly string[]).includes(docArea) ? docArea : null,
          // ローマ字の住所(`1 Chome-6-3 Kabukicho`)は集めた文書の日本語より読みにくい。
          // 市区町村しか無いときはそれだけでも出す(「位置を直す」の起点になる)
          address:
            address && /[぀-ヿ一-鿿]/.test(address)
              ? locality && !address.includes(locality)
                ? `${locality}${address}`
                : address
              : locality,
          website: str(doc?.extra?.website, 500),
        };
      }
    }
  }
  return null;
}

/**
 * 所在地の文字列を、突き合わせに使う地名に切り分ける。
 *
 * **行政単位で切る。** 「東京都新宿区」は1語で書かれるので、末尾の「区」だけを
 * 落とすと「東京都新宿」になり、地物側の「東京都 新宿区 …」のどこにも現れない
 * (実測で、辞典に在る店が丸ごと落ちた)。単位ごとに切って「東京」「新宿」にすれば当たる。
 */
function areaWords(area: string): string[] {
  const out: string[] = [];
  for (const m of area.matchAll(/([^\s,、。]+?)[都道府県市区町村郡]/g)) {
    if (m[1].length >= 2 && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * 集めた文書の所在地と、地物の所在地が同じ場所を指しているか。
 *
 * 突き合わせは**地名の語ごと**で、どれか1つでも一致すれば同じ場所とみなす ——
 * 「東京都新宿区西新宿」と「東京都新宿区」のように粒度が揃わないのが普通なので、
 * 文字列としての一致を求めると、正しい相手まで落ちる。
 *
 * **確かめられないときは当てない**(所在地が読めない・地物側に所在地が無い)。
 * 名前が同じだけの別の場所を掴むと、座標もURLも黙って別のものに置き換わる
 * (実測: 「新宿御苑」で引いた1件目が、世田谷区にある同名の地物だった)——
 * 取りこぼすより悪い。当てなかった候補は「地図データに無い」の印が付いて残る。
 */
function matchesArea(area: string | null, parts: (string | null)[]): boolean {
  const haystack = parts.filter(Boolean).join(" ");
  if (!haystack.trim()) return false;
  const words = areaWords(area ?? "");
  if (words.length === 0) return false;
  return words.some((w) => haystack.includes(w));
}

/** 集めた文書の所在地から都道府県を拾う(地図辞典で取れなかったときの控え) */
function prefectureFromArea(area: string | null): string | null {
  if (!area) return null;
  return (PREFECTURES as readonly string[]).find((p) => area.includes(p)) ?? null;
}

export async function GET(request: Request) {
  const ctx = await resolveCollectContext(request);
  if ("error" in ctx) return ctx.error;
  const { spotType, baseUrl, source } = ctx;

  if (resolveRegionScope(spotType) !== "jp") {
    return NextResponse.json(
      { error: "座標の引き直しに使う地図データが日本のぶんだけのため、日本の種別でのみ使えます。" },
      { status: 400 }
    );
  }

  // **`fields`で`body`まで取る。** 既定は`opening`(1段落に均したもの)だけで、
  // そこでは改行が落ちる —— 所在地を行として書かせているので、本文が要る
  const { data, error } = await chiezo<ChiezoRecentResponse>(
    baseUrl,
    `/v1/${encodeURIComponent(source)}/recent?limit=${COLLECT_FETCH_LIMIT}` +
      `&fields=title,body,opening,tags,extra,updated_at`
  );
  // 円を指定されたら、その中が収集済みかも一緒に見る(指定が無ければ全体から取り出す)
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const radius = Number(searchParams.get("radius"));
  const circle =
    Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radius) && radius > 0
      ? { center: { lat, lng }, radius }
      : null;
  // **区画の巡回記録から見る。** 円に重なる区画のうち、「ざっと」が一度でも
  // 見たものがいくつか —— 地名の突き合わせが要らないのがこの方式の要
  const collection = circle ? await fetchCollection(baseUrl, source) : null;
  const coverage = circle
    ? partitionCoverage(circle.center, circle.radius, collection?.partitions ?? [])
    : null;
  // 座標を引き当てられなかった候補が円の中の話かを見るための、中心の地域。
  // **中心1点だけでよい** —— 円が跨ぐ隣まで拾う必要があったのは収集済みの
  // 判定のほうで、そちらは区画が答えるようになった
  const circleArea = circle ? await areaAt(baseUrl, circle.center) : null;

  if (error) {
    // まだ1回も焼けていないとソース自体が無い。**それは失敗ではない**ので、
    // 「まだ集まっていない」と読める形で返す(依頼した直後は必ずここを通る)。
    // **円の判定は返す** —— 「まだ集めていない範囲」だと分かるほうが、
    // 何も出ないことより読める
    if (error.startsWith("404")) {
      return NextResponse.json({
        data: {
          candidates: [],
          source: "collect",
          backend: null,
          model: null,
          searched_at: new Date().toISOString(),
          center_region: null,
          coverage,
        } satisfies CollectCandidatesResult,
      });
    }
    return NextResponse.json({ error }, { status: 502 });
  }

  const docs = (data?.docs ?? [])
    .map(toDoc)
    .filter((d): d is CollectedDoc => d !== null);

  // 既存スポットは種別ぶん全部を名前で引く。**座標では絞れない** ——
  // 集めたものは全国に散らばるので、周辺を探すのような矩形の当たりが使えない
  const { rows: existingSpots } = await query<Pick<Spot, "id" | "name" | "lat" | "lng">>(
    `select id, name, lat, lng from spots
      where spot_type_id = $1 and status in ('published', 'pending')`,
    [spotType.id]
  );
  const existingByName = new Map(
    existingSpots.map((s) => [normalizeSpotName(s.name), s] as const)
  );

  // 辞典はローカルなので**候補ぶん並列**に引く(1件ずつ待つと件数ぶん伸びる)
  const searchedAt = new Date().toISOString();
  const matches = await Promise.all(
    docs.map((doc) => lookupOnMap(baseUrl, doc.title, parseCollectedArea(doc.body)))
  );

  const candidates: DiscoveryCandidate[] = docs.map((doc, i) => {
    const area = parseCollectedArea(doc.body);
    const match = matches[i];
    const existing =
      existingByName.get(normalizeSpotName(doc.title)) ??
      (match
        ? (existingSpots.find(
            (s) => distanceMeters({ lat: match.lat, lng: match.lng }, s) <=
              DISCOVERY_DUPLICATE_DISTANCE_M
          ) ?? null)
        : null);
    return {
      name: doc.title,
      name_kana: null,
      address: match?.address ?? area,
      region: match?.region ?? prefectureFromArea(area),
      // **当たらなかった候補の座標は0,0にしない。** 地図の印が海の上に立つと、
      // 一覧で見分けられないうえ「位置を直す」の起点にもならない。
      // 座標が無いものは`location_verified: false`で、画面が住所から引き直せる
      lat: match?.lat ?? 0,
      lng: match?.lng ?? 0,
      genre: doc.tags[0] ?? null,
      summary: parseCollectedSummary(doc.body),
      rank: null,
      rank_reason: null,
      url: doc.url ?? match?.website ?? null,
      location_verified: !!match,
      // 中心が無いので距離は測れない。0にしておく(画面は距離を出すだけ)
      distance_m: 0,
      dataset: null,
      existing: existing ? { id: existing.id, name: existing.name } : null,
    };
  });

  // 円を指定されたら、その中のものだけ返す。**座標の引けなかった候補は所在地で見る**
  // —— 新しい店は地図辞典に載っていないのが普通で、そこを落とすとこの機能で
  // 拾いたいものがちょうど落ちる(円の跨ぐ地域に居れば中とみなす)
  const inCircle = (c: DiscoveryCandidate) => {
    if (!circle) return true;
    if (c.lat !== 0 || c.lng !== 0) {
      return distanceMeters(circle.center, { lat: c.lat, lng: c.lng }) <= circle.radius;
    }
    if (!circleArea) return true;
    const area = c.address ?? c.region ?? "";
    return area.includes(circleArea.municipality);
  };

  const result: CollectCandidatesResult = {
    candidates: candidates.filter(inCircle),
    source: "collect",
    backend: null,
    model: null,
    searched_at: searchedAt,
    center_region: null,
    coverage,
  };
  return NextResponse.json({ data: result });
}
