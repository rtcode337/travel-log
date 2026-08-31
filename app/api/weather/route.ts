import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/current-user";
import type { DailyWeather } from "@/lib/weather";

/**
 * 予定の日・その地点の天気予報(Open-Meteo)。
 *
 * **Open-Meteoを選んだのは、APIキーが要らず座標と日付でそのまま引けるため。**
 * 天気サービスのページは日付を指定して開けない(`lib/weather.ts`)ので、
 * 「その日の天気をAIに聞く」リンクは残したまま、アイコンだけを実際の予報に合わせる。
 * データはCC-BY 4.0(出典表示が要る。画面のツールチップとREADMEに書いてある)。
 *
 * **複数の地点を1回のリクエストでまとめて引く**(座標をカンマ区切りで渡せる)。
 * 旅程の1画面に何十件も並ぶので、行ごとに引くと同じ日の同じ予報を何度も取りに行く。
 *
 * `timezone=auto`は地点ごとに解決されるので、国外のスポットでも「その土地の1日」で返る。
 *
 * **問い合わせ方は2つ**あり、どちらも同じキャッシュ(地点×日)を使う。
 *
 * | クエリ | 返るもの |
 * |---|---|
 * | `?date=YYYY-MM-DD&points=…` | `data`: 地点ごとの1日ぶん(`(DailyWeather\|null)[]`) |
 * | `?start=…&end=…&points=…` | `data.dates`: 日付の並び、`data.byPoint`: 地点ごと×日ごと |
 *
 * 範囲で引けるのは、[予定日の前後で天気の良い日を探す](../../../components/PlanWeatherFinder.tsx)ため。
 * **上流も範囲をそのまま受け取れる**ので、15日ぶんを引いても呼び出しは1回で済む。
 */

/** 予報の対象にできる日の範囲。Open-Meteoの許容(過去92日〜先15日)より内側に取る */
const PAST_DAYS = 85;
const FUTURE_DAYS = 14;

/** 座標を丸める桁。予報の格子は数kmあるので、100m単位まで見れば十分細かい */
const COORD_DIGITS = 3;

/** 1回のリクエストで引ける地点数。これより多い分は予報なしとして返す */
const MAX_POINTS = 60;

/** 範囲で引ける日数の上限。予報が出るのは先15日ほどなので、それを覆う長さで足りる */
const MAX_DAYS = 31;

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 2000;
/** 上流へ連続で投げない間隔。無料の公開APIなので自分で間隔を空ける */
const MIN_UPSTREAM_INTERVAL_MS = 250;

const cache = new Map<string, { at: number; weather: DailyWeather | null }>();
let lastUpstreamAt = 0;
/** 上流への呼び出しを直列につなぐ鎖(同時に何本も投げない) */
let upstreamChain: Promise<unknown> = Promise.resolve();

interface OpenMeteoDaily {
  daily?: {
    time?: string[];
    weather_code?: (number | null)[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_probability_max?: (number | null)[];
  };
}

/** 今日(JST)。予報の範囲に入っているかの判定に使う */
function todayJst(): Date {
  const now = new Date();
  return new Date(
    Math.floor((now.getTime() + 9 * 3600_000) / 86_400_000) * 86_400_000
  );
}

/** その日が予報を引ける範囲にあるか(範囲外は上流が400を返すので、投げる前に落とす) */
function inForecastRange(date: string): boolean {
  const target = new Date(date + "T00:00:00Z").getTime();
  if (Number.isNaN(target)) return false;
  const today = todayJst().getTime();
  return (
    target >= today - PAST_DAYS * 86_400_000 &&
    target <= today + FUTURE_DAYS * 86_400_000
  );
}

/** "35.658,139.701;34.702,135.495" → 座標の配列。壊れた要素はnullにして位置を保つ */
function parsePoints(raw: string): ({ lat: number; lng: number } | null)[] {
  return raw.split(";").map((part) => {
    const [lat, lng] = part.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: Number(lat.toFixed(COORD_DIGITS)), lng: Number(lng.toFixed(COORD_DIGITS)) };
  });
}

function cacheKey(point: { lat: number; lng: number }, date: string): string {
  return `${point.lat},${point.lng}|${date}`;
}

function readCache(key: string): DailyWeather | null | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.weather;
}

function writeCache(key: string, weather: DailyWeather | null): void {
  // 取り直せるデータなので、溢れたら丸ごと捨てる(凝った追い出しをする理由がない)
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, { at: Date.now(), weather });
}

/**
 * 上流を叩く。前回から間を空け、同時には1本しか投げない。
 * 返すのは**地点ごと×`dates`ごと**(引けなかった日はnull)。
 */
async function fetchUpstream(
  points: { lat: number; lng: number }[],
  dates: string[]
): Promise<(DailyWeather | null)[][]> {
  const empty = () => points.map(() => dates.map(() => null));
  const run = async () => {
    const wait = MIN_UPSTREAM_INTERVAL_MS - (Date.now() - lastUpstreamAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastUpstreamAt = Date.now();
    const params = new URLSearchParams({
      latitude: points.map((p) => p.lat).join(","),
      longitude: points.map((p) => p.lng).join(","),
      daily:
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "auto",
      start_date: dates[0],
      end_date: dates[dates.length - 1],
    });
    const res = await fetch("https://api.open-meteo.com/v1/forecast?" + params, {
      headers: {
        // 相手のログでどのアプリか分かるようにする(個人の連絡先は載せない)
        "User-Agent": "travel-log-personal-app/1.0",
        Accept: "application/json",
      },
    });
    if (!res.ok) return empty();
    const body: unknown = await res.json();
    // 地点が1つのときはオブジェクト、複数のときは配列で返る
    const list: OpenMeteoDaily[] = Array.isArray(body)
      ? (body as OpenMeteoDaily[])
      : [body as OpenMeteoDaily];
    return points.map((_, i) => {
      const daily = list[i]?.daily;
      // 返ってきた日付の並びに当てて拾う(欠けた日があっても位置がずれないように)
      const at = new Map<string, number>();
      daily?.time?.forEach((t, j) => at.set(t, j));
      return dates.map((date) => {
        const j = at.get(date);
        const code = j == null ? null : daily?.weather_code?.[j];
        if (j == null || code == null) return null;
        return {
          code,
          tmax: daily?.temperature_2m_max?.[j] ?? null,
          tmin: daily?.temperature_2m_min?.[j] ?? null,
          pop: daily?.precipitation_probability_max?.[j] ?? null,
        };
      });
    });
  };
  const queued = upstreamChain.then(run, run);
  // 失敗しても鎖を切らない(次のリクエストが投げられなくなるため)
  upstreamChain = queued.catch(() => undefined);
  return queued;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `start`〜`end`の日付を1日ずつ並べる。上限を超えたぶんは切る */
function expandDates(start: string, end: string): string[] {
  const out: string[] = [];
  const from = new Date(start + "T00:00:00Z").getTime();
  const to = new Date(end + "T00:00:00Z").getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return out;
  for (let t = from; t <= to && out.length < MAX_DAYS; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * 地点×日の予報を、キャッシュに無いぶんだけ上流から引いて埋める。
 * **キャッシュは日ごと**なので、範囲で引いても1日で引いても同じものを使い回せる。
 */
async function collect(
  points: ({ lat: number; lng: number } | null)[],
  dates: string[]
): Promise<(DailyWeather | null)[][]> {
  const results = points.map(() => dates.map(() => null as DailyWeather | null));
  // 予報の範囲外の日は上流が400を返すので、投げる前に落とす
  const askable = dates.filter(inForecastRange);
  const missing = new Map<string, { lat: number; lng: number }>();
  points.forEach((point, i) => {
    if (!point || i >= MAX_POINTS) return;
    dates.forEach((date, j) => {
      if (!askable.includes(date)) return;
      const cached = readCache(cacheKey(point, date));
      if (cached !== undefined) results[i][j] = cached;
      else missing.set(`${point.lat},${point.lng}`, point);
    });
  });

  if (missing.size === 0 || askable.length === 0) return results;

  const targets = [...missing.values()];
  let fetched: (DailyWeather | null)[][];
  try {
    fetched = await fetchUpstream(targets, askable);
  } catch {
    fetched = targets.map(() => askable.map(() => null));
  }
  targets.forEach((point, t) => {
    askable.forEach((date, d) => {
      const weather = fetched[t]?.[d] ?? null;
      // 取れなかったものは覚えない(通信の失敗を30分引きずらないため)
      if (weather) writeCache(cacheKey(point, date), weather);
    });
  });
  // 引いた結果を、渡された地点・日の並びへ戻す
  points.forEach((point, i) => {
    if (!point || i >= MAX_POINTS) return;
    dates.forEach((date, j) => {
      if (results[i][j]) return;
      const cached = readCache(cacheKey(point, date));
      if (cached !== undefined) results[i][j] = cached;
    });
  });
  return results;
}

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? "";
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";
  const rawPoints = searchParams.get("points") ?? "";
  if (!rawPoints) {
    return NextResponse.json({ error: "points is required" }, { status: 400 });
  }
  const points = parsePoints(rawPoints);

  // 範囲で引く(予定日の前後を並べて見るため)
  if (start || end) {
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json(
        { error: "start and end are required" },
        { status: 400 }
      );
    }
    const dates = expandDates(start, end);
    if (dates.length === 0) {
      return NextResponse.json({ error: "invalid range" }, { status: 400 });
    }
    // `data`の中に入れる —— api-clientは`data`キーがあれば中身だけを取り出すので、
    // 外に並べると`dates`が呼び出し側に届かない(lib/api-client.tsのfetchAndParse)
    return NextResponse.json({
      data: { dates, byPoint: await collect(points, dates) },
    });
  }

  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }
  // 範囲外の日・多すぎる地点は「予報なし」で返す。呼び出し側は
  // 予報が無いときの見せ方(「天気」ボタン)を必ず持っているので、エラーにはしない
  const collected = await collect(points, [date]);
  return NextResponse.json({ data: collected.map((row) => row[0] ?? null) });
}
