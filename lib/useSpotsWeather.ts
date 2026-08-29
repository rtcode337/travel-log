"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { DailyWeather } from "@/lib/weather";

/**
 * 旅程に並んでいる地点の、その日の予報をまとめて引く。
 *
 * **行ごとに引かない。** 1つの旅程に何十件も並ぶので、まとめて1回のリクエストにする
 * (`/api/weather`が地点をまとめて上流へ渡す)。
 *
 * **依存は座標と日付から作った文字列だけ**にしてある —— 呼び出し側の配列は描画のたびに
 * 作り直されるので、配列そのものを依存に置くと引き続けることになる。
 *
 * 予報が無い日(先すぎる・古すぎる)や通信の失敗は、そのスポットの値をnullにして返す。
 * 呼び出し側は「予報が無いときの見せ方」を必ず持つこと(天気を偽らないため)。
 */
export function useSpotsWeather(
  points: { id: string; lat: number; lng: number }[],
  date: string | null
): Map<string, DailyWeather> {
  const [weather, setWeather] = useState<Map<string, DailyWeather>>(new Map());
  // 同じ問い合わせを繰り返さないための鍵。座標は問い合わせに使う桁で丸める
  const key = useMemo(
    () =>
      date
        ? date + "|" + points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(";")
        : "",
    [date, points]
  );
  // 依存に置くのは key だけなので、最新の points は ref から読む
  const pointsRef = useRef(points);
  pointsRef.current = points;

  useEffect(() => {
    if (!key) {
      setWeather(new Map());
      return;
    }
    const targets = pointsRef.current;
    if (targets.length === 0 || !date) {
      setWeather(new Map());
      return;
    }
    let alive = true;
    api.weather
      .daily(targets, date)
      .then(({ data }) => {
        if (!alive || !data) return;
        const next = new Map<string, DailyWeather>();
        targets.forEach((point, i) => {
          const w = data[i];
          if (w) next.set(point.id, w);
        });
        setWeather(next);
      })
      .catch(() => {
        // 予報が引けなくても旅程は読める。アイコンを出さないだけにする
      });
    return () => {
      alive = false;
    };
    // date は key に含まれている(key が変わらなければ日付も変わらない)
  }, [key, date]);

  return weather;
}
