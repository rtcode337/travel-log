import { buildGeminiSearchUrl } from "@/lib/askAi";
import type { Spot } from "@/lib/types";

/**
 * 訪問予定リストの各スポットの天気を見るためのリンクを組み立てる。
 *
 * **AI(Gemini=Google検索のAIモード)に日付を添えて聞く形にしてある。**
 * 天気サービスのページはどれも「今日から数日」の予報を出すだけで、
 * **予定の日を指定して開けるものが無い**(Yahoo!天気やtenki.jpのピンポイント予報は
 * 地点コードが要るうえ日付も選べず、座標で開ける海外サービスも同様)。
 * 旅程で知りたいのは「その日その場所の天気」なので、日付とスポットを渡して
 * 調べてもらうほうが目的に近い。
 *
 * **同名の別スポットに答えられないよう、所在地と座標を添える**
 * (`lib/askAi.ts`の質問文と同じ理由。「光明寺」のように同じ名前の場所が各地にある)。
 *
 * **予報が出ていない先の日付でも空振りにしない** —— その場合は平年の傾向を答えるよう
 * 頼んでおく。10日先より後の予定でも、服装や雨具の見当を付ける役には立つため。
 */
export function buildSpotWeatherQuestion(spot: Spot, date: string): string {
  const where = [spot.region, `${spot.lat.toFixed(5)},${spot.lng.toFixed(5)}`]
    .filter(Boolean)
    .join(" / ");
  return (
    `${formatWeatherDateLong(date)}の「${spot.name}」(${where})の天気を教えてください。` +
    `最高気温・最低気温、降水の見込み、風の強さが知りたいです。` +
    `その日の予報がまだ出ていない場合は、予報が出ている直近までの傾向と、` +
    `その時期の平年の天候(気温・降水)を教えてください。`
  );
}

/** そのスポットのその日の天気をAIに聞くURL */
export function buildSpotWeatherAskUrl(spot: Spot, date: string): string {
  return buildGeminiSearchUrl(buildSpotWeatherQuestion(spot, date));
}

/**
 * 天気を聞く対象の日。**開始日 → 終了日 → 今日**の順に決める
 * (現在のDBでは開始日は必須だが、入っていない場合の順序を決めておく)。
 */
export function planWeatherDate(list: {
  start_date?: string | null;
  end_date?: string | null;
}): string {
  return list.start_date || list.end_date || todayKey();
}

/** 今日のローカル日付(`YYYY-MM-DD`)。VisitPlanListFormModalと同じ決め方 */
function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 「8/20」。リンクの説明に添える短い表記 */
export function formatWeatherDate(date: string): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return date;
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** 「2026年8月20日」。質問文に入れる表記(年まで書かないと別の年に取られる) */
function formatWeatherDateLong(date: string): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return date;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/** 天気リンクに添える説明(`title`/`aria-label`) */
export function weatherLinkLabel(spotName: string, date: string): string {
  return `${spotName}の${formatWeatherDate(date)}の天気をAIに聞く`;
}

/** その日その地点の予報(`/api/weather`。Open-Meteoのdailyを1日分に切り出したもの) */
export interface DailyWeather {
  /** WMOの天気コード(0=快晴 … 95=雷雨) */
  code: number;
  /** 最高・最低気温(℃)と降水確率(%)。欠けることがあるのでnullを許す */
  tmax: number | null;
  tmin: number | null;
  pop: number | null;
}

/**
 * WMOの天気コード → 絵文字と日本語。
 * **コードは範囲で丸めて扱う**(0-3=晴れ〜くもり、5x=霧雨、6x=雨、7x/8x後半=雪、9x=雷雨)。
 * 細かい区別(着氷性の霧雨など)は旅程の見出しには要らないので、近いものへ寄せる。
 */
export function weatherLook(code: number): { icon: string; text: string } {
  if (code === 0) return { icon: "☀️", text: "快晴" };
  if (code === 1) return { icon: "🌤️", text: "晴れ" };
  if (code === 2) return { icon: "⛅", text: "晴れ時々くもり" };
  if (code === 3) return { icon: "☁️", text: "くもり" };
  if (code === 45 || code === 48) return { icon: "🌫️", text: "霧" };
  if (code >= 51 && code <= 57) return { icon: "🌦️", text: "霧雨" };
  if (code >= 61 && code <= 67) return { icon: "🌧️", text: "雨" };
  if (code >= 71 && code <= 77) return { icon: "❄️", text: "雪" };
  if (code >= 80 && code <= 82) return { icon: "🌦️", text: "にわか雨" };
  if (code >= 85 && code <= 86) return { icon: "🌨️", text: "にわか雪" };
  if (code >= 95) return { icon: "⛈️", text: "雷雨" };
  // 未知のコードは晴れにも雨にも寄せない(判断できないことが伝わるようにする)
  return { icon: "🌡️", text: "天気" };
}

/** 「くもり 26/21℃ 降水20%」。リンクの説明に添える1行 */
export function weatherSummary(weather: DailyWeather): string {
  const parts = [weatherLook(weather.code).text];
  if (weather.tmax != null || weather.tmin != null) {
    const max = weather.tmax != null ? Math.round(weather.tmax) : "－";
    const min = weather.tmin != null ? Math.round(weather.tmin) : "－";
    parts.push(`${max}/${min}℃`);
  }
  if (weather.pop != null) parts.push(`降水${weather.pop}%`);
  return parts.join(" ");
}
