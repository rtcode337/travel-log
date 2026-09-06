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
  MAX_DISCOVERY_CANDIDATES,
  MAX_DISCOVERY_QUERY_LENGTH,
  distanceMeters,
  normalizeSpotName,
  type DiscoveryCandidate,
  type DiscoveryResult,
} from "@/lib/spotDiscovery";
import { addressOf, bboxAround, featuresForWord, genreOf } from "@/lib/osmNearby";
import { discoveryBaseUrl } from "@/lib/aiDiscoveryConfig";

/**
 * 地図データ(chiezoのOSM辞典)から周辺のスポット候補を返す(spot_admin/admin専用)。
 * **「周辺を探す」の1段目**で、AIを使う`/api/spots/discover`と同じ形の候補を返すので、
 * 画面(地図の印と右のパネル)は出どころを問わず同じものを並べられる。
 *
 * **速さのための段**。AIに聞くと30秒〜2分かかり、「近くの飲食店をちょっと見たい」には
 * 使えなかった。こちらはローカルのSQLiteを引くだけなので**1秒かからない**うえ、
 * AIの枠も使わない。座標は地図データそのものなので正確(`location_verified`は常にtrue)。
 *
 * **代わりに落ちるもの**: 新しい店は載っていないことが多く(実測: 新宿1kmに飲食店882件
 * あるのに、AIが挙げた有名店4件のうちOSMで引けたのは1件)、説明文も持たない。
 * 足りないぶんは画面から「AIで探し足す」で同じ一覧に足す。
 *
 * **探し方は2つ投げて混ぜる**(`lib/osmNearby.ts`):
 * 全文検索は「ラーメン」のように名前に出る語に強く、種別の絞り込みは「ランチ」のように
 * 名前に出ない語に要る。片方だけだと、どちらかの語で何も出ない。
 *
 * **日本語圏(`region_scope='jp'`)専用**。chiezoに入っているOSM辞典が日本の抽出のため。
 */

// ローカルのSQLiteを引くだけだが、候補ぶんの`doc`を並列に投げるので少し余裕を見る
export const maxDuration = 60;

/** chiezoの1問い合わせの上限。あちらは5秒でクエリを切るので、それより少し長く */
const CHIEZO_TIMEOUT_MS = 8_000;

const USER_AGENT = "travel-log-personal-app/1.0";

interface OsmExtra {
  lat?: unknown;
  lon?: unknown;
  area?: unknown;
  feature?: unknown;
  tags?: Record<string, unknown>;
}

interface OsmSearchResponse {
  results?: { title?: unknown }[];
}

interface OsmFilterResponse {
  total?: unknown;
  results?: { title?: unknown; extra?: OsmExtra }[];
}

interface OsmDocResponse {
  title?: unknown;
  extra?: OsmExtra;
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

/** OSMの1地物を候補の素にする。名前と座標が無いものは捨てる */
function toRaw(
  title: string,
  extra: OsmExtra | undefined
): {
  title: string;
  name: string;
  lat: number;
  lng: number;
  genre: string | null;
  address: string | null;
  url: string | null;
  area: string | null;
} | null {
  const lat = Number(extra?.lat);
  const lng = Number(extra?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const tags = (extra?.tags ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  // 同名の地物は chiezo 側で「名前 (node:123)」に弁別されているので、表示名は元に戻す
  const name = str(tags.name) ?? title.replace(/\s*\((?:node|way|relation):\d+\)$/, "");
  if (!name) return null;
  const feature = str(extra?.feature);
  return {
    title,
    name,
    lat,
    lng,
    genre: genreOf(feature, str(tags.cuisine)),
    address: addressOf(tags),
    url: str(tags.website) ?? str(tags["contact:website"]),
    area: str(extra?.area),
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
  const limitRaw = Number(searchParams.get("limit"));
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

  // ① 種別での絞り込み(名前に出ない語のため)。検索語が無いときもこちらだけで並ぶ
  const features = searchQuery ? featuresForWord(searchQuery) : [];
  const filterParams = new URLSearchParams({
    bbox,
    limit: String(Math.min(limit * 4, 200)),
    fields: "title,extra",
  });
  if (features.length > 0) filterParams.set("feature", features.join(","));
  const filterPromise =
    features.length > 0 || !searchQuery
      ? chiezoGet<OsmFilterResponse>(baseUrl, "/v1/osm_japan/filter", filterParams)
      : Promise.resolve(null);

  // ② 全文検索(名前に出る語のため)。座標は載らないので、当たった題名で`doc`を引き直す
  const searchPromise = searchQuery
    ? chiezoGet<OsmSearchResponse>(
        baseUrl,
        "/v1/osm_japan/search",
        new URLSearchParams({ q: searchQuery, bbox, limit: String(Math.min(limit * 2, 50)) })
      )
    : Promise.resolve(null);

  const [filtered, found, { rows: existingSpots }] = await Promise.all([
    filterPromise,
    searchPromise,
    existingPromise,
  ]);

  type OsmRaw = NonNullable<ReturnType<typeof toRaw>>;
  const byTitle = new Map<string, OsmRaw>();
  for (const r of filtered?.results ?? []) {
    if (typeof r.title !== "string") continue;
    const raw = toRaw(r.title, r.extra);
    if (raw) byTitle.set(r.title, raw);
  }
  // 全文検索の当たりは`doc`で座標を取る。ローカルなので**並列**に投げる
  const missingTitles = (found?.results ?? [])
    .map((r) => (typeof r.title === "string" ? r.title : null))
    .filter((t): t is string => !!t && !byTitle.has(t));
  const docs = await Promise.all(
    missingTitles.map((title) =>
      chiezoGet<OsmDocResponse>(
        baseUrl,
        "/v1/osm_japan/doc",
        new URLSearchParams({ title, fields: "title,extra" })
      )
    )
  );
  docs.forEach((doc, i) => {
    const raw = toRaw(missingTitles[i], doc?.extra);
    if (raw) byTitle.set(missingTitles[i], raw);
  });

  const existingByName = new Map(
    existingSpots.map((s) => [normalizeSpotName(s.name), s] as const)
  );
  // 中心の地域は、当たった地物が持つ`area`から取る(全部同じ市区にあるので1つでよい)
  const centerRegion =
    [...byTitle.values()]
      .map((r) => r.area)
      .find((a): a is string => !!a && (PREFECTURES as readonly string[]).includes(a)) ?? null;

  const candidates: DiscoveryCandidate[] = [...byTitle.values()]
    // 半径の外(bboxは矩形なので角が余る)を落としてから、近い順に並べる
    .map((raw) => ({ raw, distance: distanceMeters(center, { lat: raw.lat, lng: raw.lng }) }))
    .filter(({ distance }) => distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
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
        region: raw.area && (PREFECTURES as readonly string[]).includes(raw.area) ? raw.area : centerRegion,
        lat: raw.lat,
        lng: raw.lng,
        genre: raw.genre,
        // 地図データは説明文を持たない。要るならAIで探し足すか、後から手で書く
        summary: null,
        rank: null,
        rank_reason: null,
        url: raw.url,
        // 座標は地図データそのものなので、確かめる相手がいない=常に確認済み扱い
        location_verified: true,
        distance_m: Math.round(distance),
        existing: existing ? { id: existing.id, name: existing.name } : null,
      };
    });

  const result: DiscoveryResult = {
    candidates,
    source: "osm",
    backend: null,
    model: null,
    searched_at: searchedAt,
    center_region: centerRegion,
  };
  return NextResponse.json({ data: result });
}
