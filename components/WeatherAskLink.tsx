"use client";

import {
  buildSpotWeatherAskUrl,
  weatherLinkLabel,
  weatherLook,
  weatherSummary,
} from "@/lib/weather";
import type { DailyWeather } from "@/lib/weather";
import type { Spot } from "@/lib/types";

/**
 * そのスポットの、予定の日の天気。**予報が引けていればその天気のアイコン**、
 * 引けていなければ「天気」のボタンになり、どちらも押すと日付を添えてAIに聞く。
 *
 * **天気サービスは日付を指定して開けない**ので、リンク先はAIのまま
 * (理由は`lib/weather.ts`)。アイコンだけを実際の予報(`/api/weather`=Open-Meteo)に
 * 合わせている。**予報が無いのに晴れのアイコンを出さない** —— 以前は常に太陽で、
 * 「その日は晴れる」と読めてしまっていた。予報が出るのは先15日ほどまでなので、
 * それより先の予定では「天気」のボタンのまま置く(押せばAIが平年の傾向を答える)。
 *
 * **リスト詳細と地図の経路詳細で同じものを出す。** 旅程を見る場所は2つあり、
 * 片方だけに天気があると「地図から見たときだけ調べ直す」ことになる。
 * **行のボタンの中には置けない**(ボタンの入れ子になる)ので、独立したリンクとして隣に並べる。
 */
export default function WeatherAskLink({
  spot,
  date,
  weather,
  className = "",
}: {
  spot: Spot;
  date: string;
  /** その日の予報。無ければ「天気」のボタンになる */
  weather?: DailyWeather | null;
  className?: string;
}) {
  const ask = weatherLinkLabel(spot.name, date);
  // 予報の出どころ(Open-Meteo)はCC-BYで出典表示が要る。押す前に読める場所に置く
  const label = weather ? `${ask}(予報: ${weatherSummary(weather)} / Open-Meteo)` : ask;
  return (
    <a
      href={buildSpotWeatherAskUrl(spot, date)}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      // 行のタップ(スポットへ移動・詳細を開く)まで走らせない
      onClick={(e) => e.stopPropagation()}
      className={
        weather
          ? `shrink-0 rounded-full px-1 py-1 text-base leading-none hover:bg-gray-100 ${className}`
          : `shrink-0 rounded-full border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 ${className}`
      }
    >
      {weather ? (
        <span aria-hidden="true">{weatherLook(weather.code).icon}</span>
      ) : (
        "天気"
      )}
    </a>
  );
}
