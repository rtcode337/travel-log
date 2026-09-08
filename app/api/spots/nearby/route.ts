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
import {
  DISCOVERY_DUPLICATE_DISTANCE_M,
  DISCOVERY_RADIUS_OPTIONS,
  UNLIMITED_DISCOVERY_LIMIT,
  MAX_DISCOVERY_QUERY_LENGTH,
  distanceMeters,
  normalizeSpotName,
  type DiscoveryCandidate,
  type DiscoveryResult,
} from "@/lib/spotDiscovery";
import { addressOf, bboxAround, featuresForWord, genreOf } from "@/lib/osmNearby";
import {
  DEFAULT_OVERTURE_CATEGORIES,
  categoriesForWord,
  overtureGenreOf,
  prefectureFromAreaCode,
  stripOvertureSuffix,
} from "@/lib/overtureNearby";
import { discoveryBaseUrl } from "@/lib/aiDiscoveryConfig";

/**
 * 地図データ(chiezoのOverture Places辞典とOSM辞典)から周辺のスポット候補を返す
 * (spot_admin/admin専用)。**「周辺を探す」の1段目**で、AIを使う`/api/spots/discover`と
 * 同じ形の候補を返すので、画面(地図の印と右のパネル)は出どころを問わず同じものを並べられる。
 *
 * **速さのための段**。AIに聞くと30秒〜2分かかり、「近くの飲食店をちょっと見たい」には
 * 使えなかった。こちらはローカルのSQLiteを引くだけなので**1秒かからない**うえ、
 * AIの枠も使わない。座標は地図データそのものなので正確(`location_verified`は常にtrue)。
 *
 * **辞典を2つとも引いて混ぜる**。穴の位置が互いに違うので、片方だけだと必ず落ちる:
 * - Overture(301万件)は**店の数とURL**が強い。反面`extra.area`(都道府県)がほぼ空
 * - OSM(155万件)は**都道府県と構造化された住所**を持つ
 *
 * 同じ店は両方に載っているので、**名前と距離で重ねてから**返す(Overtureを優先
 * ——URLと電話を持っているぶん、候補として手掛かりが多い)。
 *
 * **代わりに落ちるもの**: どちらの辞典も説明文を持たず、開いたばかりの店は載っていない。
 * **探しているものに合うかも、記録する価値があるかも見ていない**(在るものを全部並べる)。
 * そこは2段目のAI(`/api/spots/discover`)に精査させ、足りないぶんも足させる。
 *
 * **辞典ごとに2つ投げて混ぜる**(`lib/osmNearby.ts` / `lib/overtureNearby.ts`):
 * 全文検索は「ラーメン」のように名前に出る語に強く、種別の絞り込みは「ランチ」のように
 * 名前に出ない語に要る。片方だけだと、どちらかの語で何も出ない。
 *
 * **日本語圏(`region_scope='jp'`)専用**。chiezoに入っている辞典が日本の抽出のため。
 */

// ローカルのSQLiteを引くだけだが、候補ぶんの`doc`を並列に投げるので少し余裕を見る
export const maxDuration = 60;

/** chiezoの1問い合わせの上限。あちらは5秒でクエリを切るので、それより少し長く */
const CHIEZO_TIMEOUT_MS = 8_000;

/** chiezoの`filter`が1回で返せる上限(あちらのバリデーションの値)。これ以上は`offset`で継ぐ */
const CHIEZO_PAGE = 500;

/**
 * 全文検索の当たりから`doc`を引き直す件数の上限。
 *
 * **ここだけは上限が要る。** `filter`は`extra`(座標・住所)を一緒に返すが、
 * `search`は返さないので当たり1件につき`doc`を1回叩くことになる(実測で確認)。
 * 全文検索は関連の高い順に並ぶので、深追いしても得るものが少ない
 */
const SEARCH_DOC_LOOKUPS = 200;

const USER_AGENT = "travel-log-personal-app/1.0";

interface OsmExtra {
  lat?: unknown;
  lon?: unknown;
  area?: unknown;
  feature?: unknown;
  tags?: Record<string, unknown>;
}

/** Overture側の`extra`。住所とURLが平らに入っている(OSMのようなタグの束ではない) */
interface OvertureExtra {
  lat?: unknown;
  lon?: unknown;
  /** JISの都道府県コード。**ほぼ空**なので、取れないほうが普通 */
  area?: unknown;
  locality?: unknown;
  address?: unknown;
  website?: unknown;
}

interface SearchResponse {
  results?: { title?: unknown }[];
}

interface FilterResponse<E> {
  total?: unknown;
  results?: { title?: unknown; extra?: E; tags?: unknown }[];
}

interface DocResponse<E> {
  title?: unknown;
  extra?: E;
  tags?: unknown;
}

/** 辞典から取り出した1件(候補にする前の素) */
interface MapRaw {
  dataset: "osm" | "overture";
  title: string;
  name: string;
  lat: number;
  lng: number;
  genre: string | null;
  address: string | null;
  url: string | null;
  /** 都道府県名(取れたときだけ)。OSMは`area`、Overtureはコードから引く */
  region: string | null;
}

/** chiezoへのGET。落ちていても機能ごと止めないので、失敗はnullで返す */
async function chiezoGet<T>(
  baseUrl: string,
  path: string,
  params: URLSearchParams
): Promise<T | null> {
  try {
    const res = await fetch(`${baseUrl}${path}?${params}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(CHIEZO_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** OSMの1地物を候補の素にする。名前と座標が無いものは捨てる */
function osmRaw(title: string, extra: OsmExtra | undefined): MapRaw | null {
  const lat = Number(extra?.lat);
  const lng = Number(extra?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const tags = (extra?.tags ?? {}) as Record<string, unknown>;
  // 同名の地物は chiezo 側で「名前 (node:123)」に弁別されているので、表示名は元に戻す
  const name = str(tags.name) ?? title.replace(/\s*\((?:node|way|relation):\d+\)$/, "");
  if (!name) return null;
  const area = str(extra?.area);
  return {
    dataset: "osm",
    title,
    name,
    lat,
    lng,
    genre: genreOf(str(extra?.feature), str(tags.cuisine)),
    address: addressOf(tags),
    url: str(tags.website) ?? str(tags["contact:website"]),
    region: area && (PREFECTURES as readonly string[]).includes(area) ? area : null,
  };
}

/** Overtureの1地物を候補の素にする。住所とURLは`extra`に平らに入っている */
function overtureRaw(
  title: string,
  extra: OvertureExtra | undefined,
  tags: unknown
): MapRaw | null {
  const lat = Number(extra?.lat);
  const lng = Number(extra?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = stripOvertureSuffix(title);
  if (!name) return null;
  const categories = Array.isArray(tags)
    ? tags.filter((t): t is string => typeof t === "string")
    : [];
  // 住所は自由記述で都道府県から始まらないことが多いので、市区町村を頭に足して補う
  const address = str(extra?.address);
  const locality = str(extra?.locality);
  return {
    dataset: "overture",
    title,
    name,
    lat,
    lng,
    genre: overtureGenreOf(categories),
    address: address && locality && !address.includes(locality) ? `${locality}${address}` : address,
    url: str(extra?.website),
    region: prefectureFromAreaCode(str(extra?.area)),
  };
}

export async function GET(request: Request) {
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
      { error: "この環境では周辺の取得を利用できません(CHIEZO_BASE_URL未設定)。" },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const typeKey = searchParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const { rows: typeRows } = await query<SpotType>(
    `${SPOT_TYPE_SELECT} where t.key = $1`,
    [typeKey]
  );
  const spotType = typeRows[0];
  if (!spotType) {
    return NextResponse.json({ error: "存在しない種別です。" }, { status: 404 });
  }
  if (!getSpotTypeSetting(spotType, "ai_discovery_enabled")) {
    return NextResponse.json(
      { error: "この種別では周辺の探索が無効です(管理画面の種別の設定で有効にできます)。" },
      { status: 403 }
    );
  }
  if (resolveRegionScope(spotType) !== "jp") {
    return NextResponse.json(
      {
        error:
          "地図データからの取得は日本の種別だけです(この種別は対象地域が日本ではありません)。AIで探してください。",
      },
      { status: 400 }
    );
  }

  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const radius = Number(searchParams.get("radius"));
  const searchQuery = (searchParams.get("q") ?? "").trim().slice(0, MAX_DISCOVERY_QUERY_LENGTH);
  // **件数の上限は持たない**(`limit`が無い・0なら半径の中を全部返す)。
  // ローカルのSQLiteを引くだけなので絞る理由が無く、絞ると「この辺に何があるか」を
  // 見るという地図データ側の使い方ができない。`limit`を渡せば絞れる形は残してある
  const limitRaw = Number(searchParams.get("limit"));
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : UNLIMITED_DISCOVERY_LIMIT;
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
  const center = { lat, lng };
  const bbox = bboxAround(center, radius);
  const searchedAt = new Date().toISOString();

  // 既存スポットは半径の2倍の矩形で粗く取り、突き合わせは距離で行う
  const latPad = (radius * 2) / 111_000;
  const lngPad = (radius * 2) / (111_000 * Math.max(Math.cos((lat * Math.PI) / 180), 0.1));
  const existingPromise = query<{ id: string; name: string; lat: number; lng: number }>(
    `select id, name, lat, lng from spots
     where spot_type_id = $1 and status in ('published', 'pending')
       and lat between $2 and $3 and lng between $4 and $5`,
    [spotType.id, lat - latPad, lat + latPad, lng - lngPad, lng + lngPad]
  );

  /**
   * `filter`を**最後まで読み切る**(`offset`で継ぐ)。`limit`が指定されていれば
   * そこで止める。あちらは1回500件までなので、半径が広いと何往復かする
   * (実測: 半径5kmの新宿で2つの辞典の合計36,580件 = 74往復)
   */
  const filterAll = async <E>(
    source: "osm_japan" | "overture_japan",
    params: URLSearchParams
  ): Promise<FilterResponse<E>> => {
    const page = (offset: number) => {
      const p = new URLSearchParams(params);
      p.set("limit", String(CHIEZO_PAGE));
      p.set("offset", String(offset));
      return chiezoGet<FilterResponse<E>>(baseUrl, `/v1/${source}/filter`, p);
    };
    const first = await page(0);
    const total = typeof first?.total === "number" ? first.total : undefined;
    const results = [...(first?.results ?? [])];
    // 欲しい件数(上限が無ければ全部)に足りなければ、**残りの頁は一度に投げる**。
    // 1頁ずつ待つと半径1kmで11秒かかった(実測)—— 1回目でtotalが分かるので、
    // 何頁要るかはそこで決まる。並列にすれば往復の回数は同じでも待ちは1往復ぶんで済む
    const want = limit > 0 ? Math.min(limit * 4, total ?? Infinity) : (total ?? results.length);
    if (total !== undefined && results.length < want) {
      const offsets: number[] = [];
      for (let o = CHIEZO_PAGE; o < want; o += CHIEZO_PAGE) offsets.push(o);
      const pages = await Promise.all(offsets.map(page));
      for (const got of pages) results.push(...(got?.results ?? []));
    }
    return { total, results };
  };

  // 辞典ごとに、①種別での絞り込みと②全文検索を投げる。**辞典の2つは並列**に投げる
  // (相手はローカルのSQLite)
  const searchLimit = String(limit > 0 ? Math.min(limit * 2, 50) : SEARCH_DOC_LOOKUPS);

  // ① 種別での絞り込み(名前に出ない語のため)。検索語が無いときもこちらだけで並ぶ
  const features = searchQuery ? featuresForWord(searchQuery) : [];
  const osmFilterParams = new URLSearchParams({ bbox, fields: "title,extra" });
  if (features.length > 0) osmFilterParams.set("feature", features.join(","));
  const osmFilterPromise =
    features.length > 0 || !searchQuery
      ? filterAll<OsmExtra>("osm_japan", osmFilterParams)
      : Promise.resolve(null);

  // Overtureは種別が`category=`。**検索語が無いときは既定のカテゴリで絞る** ——
  // 絞らないと、bboxに数千件ある中からATMや駐車場が先に並ぶ(実測: 新宿の小さな
  // bboxで7,744件)
  const categories = searchQuery ? categoriesForWord(searchQuery) : DEFAULT_OVERTURE_CATEGORIES;
  const overtureFilterParams = new URLSearchParams({ bbox, fields: "title,extra,tags" });
  if (categories.length > 0) {
    overtureFilterParams.set("feature", categories.map((c) => `category=${c}`).join(","));
  }
  const overtureFilterPromise =
    categories.length > 0
      ? filterAll<OvertureExtra>("overture_japan", overtureFilterParams)
      : Promise.resolve(null);

  // ② 全文検索(名前に出る語のため)。座標は載らないので、当たった題名で`doc`を引き直す
  const searchParamsFor = (q: string) =>
    new URLSearchParams({ q, bbox, limit: searchLimit });
  const osmSearchPromise = searchQuery
    ? chiezoGet<SearchResponse>(baseUrl, "/v1/osm_japan/search", searchParamsFor(searchQuery))
    : Promise.resolve(null);
  const overtureSearchPromise = searchQuery
    ? chiezoGet<SearchResponse>(baseUrl, "/v1/overture_japan/search", searchParamsFor(searchQuery))
    : Promise.resolve(null);

  const [osmFiltered, overtureFiltered, osmFound, overtureFound, { rows: existingSpots }] =
    await Promise.all([
      osmFilterPromise,
      overtureFilterPromise,
      osmSearchPromise,
      overtureSearchPromise,
      existingPromise,
    ]);

  // 辞典ごとに「題名 → 素」を組む。全文検索の当たりは座標が載らないので`doc`で引き直す
  const collect = async <E,>(
    source: "osm_japan" | "overture_japan",
    filtered: FilterResponse<E> | null,
    found: SearchResponse | null,
    build: (title: string, extra: E | undefined, tags: unknown) => MapRaw | null
  ): Promise<MapRaw[]> => {
    const byTitle = new Map<string, MapRaw>();
    for (const r of filtered?.results ?? []) {
      if (typeof r.title !== "string") continue;
      const raw = build(r.title, r.extra, r.tags);
      if (raw) byTitle.set(r.title, raw);
    }
    const missing = (found?.results ?? [])
      .map((r) => (typeof r.title === "string" ? r.title : null))
      .filter((t): t is string => !!t && !byTitle.has(t));
    // ローカルなので**並列**に投げる
    const docs = await Promise.all(
      missing.map((title) =>
        chiezoGet<DocResponse<E>>(
          baseUrl,
          `/v1/${source}/doc`,
          new URLSearchParams({ title, fields: "title,extra,tags" })
        )
      )
    );
    docs.forEach((doc, i) => {
      const raw = build(missing[i], doc?.extra, doc?.tags);
      if (raw) byTitle.set(missing[i], raw);
    });
    return [...byTitle.values()];
  };

  const [osmRaws, overtureRaws] = await Promise.all([
    collect("osm_japan", osmFiltered, osmFound, (t, e) => osmRaw(t, e)),
    collect("overture_japan", overtureFiltered, overtureFound, overtureRaw),
  ]);

  // 同じ店は両方の辞典に載っている。**Overtureを先に置いて、OSM側は重なりを捨てる** ——
  // URLと電話を持っているぶん候補としての手掛かりが多い。突き合わせは名前だけでなく
  // 距離も見る(表記ゆれで名前が一致しないことのほうが多い)
  const raws: MapRaw[] = [...overtureRaws];
  const takenNames = new Set(overtureRaws.map((r) => normalizeSpotName(r.name)));
  for (const raw of osmRaws) {
    const key = normalizeSpotName(raw.name);
    if (takenNames.has(key)) continue;
    const overlapping = overtureRaws.some(
      (o) =>
        normalizeSpotName(o.name) === key ||
        (distanceMeters({ lat: o.lat, lng: o.lng }, { lat: raw.lat, lng: raw.lng }) <=
          DISCOVERY_DUPLICATE_DISTANCE_M &&
          (o.name.includes(raw.name) || raw.name.includes(o.name)))
    );
    if (overlapping) continue;
    takenNames.add(key);
    raws.push(raw);
  }

  const existingByName = new Map(
    existingSpots.map((s) => [normalizeSpotName(s.name), s] as const)
  );
  // 中心の地域は、当たった地物のどれかが持つ都道府県から取る(半径は最大5kmなので
  // 全部同じ都道府県にあるとみなしてよい)。**たいていOSM側から取れる** ——
  // Overtureの`area`はほぼ空で、これが辞典を2つとも引いている理由の1つ
  const centerRegion = raws.map((r) => r.region).find((a): a is string => !!a) ?? null;

  const candidates: DiscoveryCandidate[] = raws
    // 半径の外(bboxは矩形なので角が余る)を落としてから、近い順に並べる
    .map((raw) => ({ raw, distance: distanceMeters(center, { lat: raw.lat, lng: raw.lng }) }))
    .filter(({ distance }) => distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    // **上限が指定されたときだけ切る**(地図データは既定で全件返す)
    .slice(0, limit > 0 ? limit : undefined)
    .map(({ raw, distance }) => {
      const existing =
        existingByName.get(normalizeSpotName(raw.name)) ??
        existingSpots.find(
          (s) =>
            distanceMeters({ lat: raw.lat, lng: raw.lng }, s) <= DISCOVERY_DUPLICATE_DISTANCE_M
        ) ??
        null;
      return {
        name: raw.name,
        name_kana: null,
        address: raw.address,
        region: raw.region ?? centerRegion,
        lat: raw.lat,
        lng: raw.lng,
        genre: raw.genre,
        // 地図データは説明文を持たない。要るなら2段目のAIの精査で付くか、後から手で書く
        summary: null,
        rank: null,
        rank_reason: null,
        url: raw.url,
        // 座標は地図データそのものなので、確かめる相手がいない=常に確認済み扱い
        location_verified: true,
        distance_m: Math.round(distance),
        // ライセンスが辞典ごとに違うので、どちらから来たかを候補に持たせる
        // (説明文の出どころはこれで決まる)
        dataset: raw.dataset,
        existing: existing ? { id: existing.id, name: existing.name } : null,
      };
    });

  const result: DiscoveryResult = {
    candidates,
    source: "map",
    backend: null,
    model: null,
    searched_at: searchedAt,
    center_region: centerRegion,
  };
  return NextResponse.json({ data: result });
}
