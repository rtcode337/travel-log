"use client";

import {
  buildSpotWeatherAskUrl,
  weatherLinkLabel,
} from "@/lib/weather";
import type { Spot } from "@/lib/types";

/** 天気アイコン(太陽)。外部の天気ページへ開くリンクの印 */
function SunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 17a5 5 0 100-10 5 5 0 000 10z" />
      <path d="M12 1.5a1 1 0 011 1V4a1 1 0 11-2 0V2.5a1 1 0 011-1zm0 17a1 1 0 011 1v1.5a1 1 0 11-2 0V19.5a1 1 0 011-1zM22.5 12a1 1 0 01-1 1H20a1 1 0 110-2h1.5a1 1 0 011 1zm-17 0a1 1 0 01-1 1H3a1 1 0 110-2h1.5a1 1 0 011 1zm13.6-6.6a1 1 0 010 1.42l-1.06 1.06a1 1 0 11-1.42-1.42l1.06-1.06a1 1 0 011.42 0zM7.38 16.62a1 1 0 010 1.41l-1.06 1.06a1 1 0 11-1.41-1.41l1.06-1.06a1 1 0 011.41 0zm11.24 2.47a1 1 0 01-1.42 0l-1.06-1.06a1 1 0 111.42-1.41l1.06 1.06a1 1 0 010 1.41zM7.38 7.38a1 1 0 01-1.41 0L4.91 6.32A1 1 0 016.32 4.9l1.06 1.06a1 1 0 010 1.42z" />
    </svg>
  );
}

/**
 * そのスポットの、予定の日の天気をAIに聞くリンク(太陽のアイコン)。
 *
 * **天気サービスは日付を指定して開けない**ので、日付を添えてAIに聞く形にしてある
 * (理由は`lib/weather.ts`)。日は開始日→終了日→今日の順で呼び出し側が決める。
 *
 * **リスト詳細と地図の経路詳細で同じものを出す。** 旅程を見る場所は2つあり、
 * 片方だけに天気があると「地図から見たときだけ調べ直す」ことになる。
 * **行のボタンの中には置けない**(ボタンの入れ子になる)ので、独立したリンクとして隣に並べる。
 */
export default function WeatherAskLink({
  spot,
  date,
  className = "",
}: {
  spot: Spot;
  date: string;
  className?: string;
}) {
  const label = weatherLinkLabel(spot.name, date);
  return (
    <a
      href={buildSpotWeatherAskUrl(spot, date)}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      // 行のタップ(スポットへ移動・詳細を開く)まで走らせない
      onClick={(e) => e.stopPropagation()}
      className={`shrink-0 rounded-full p-1.5 text-amber-500 hover:bg-amber-50 ${className}`}
    >
      <SunIcon className="size-5" />
    </a>
  );
}
