"use client";

import { useEffect, useState } from "react";

/**
 * 「Google マップで経路を表示」のorigin(出発地)に使う現在地を取得するhook。
 *
 * originを指定しないとGoogle マップ側が最後に開いていた地点等を出発地にして
 * しまうことがあるため、現在地が分かるときは明示的に渡す。ただし**位置情報の
 * 権限が既に許可されている場合のみ**取得する(モーダルを開いただけで権限
 * ダイアログを出さないため)。取れないときはnullを返し、呼び出し側は
 * originなし=Google マップ側の判断に委ねる挙動へ落とす。
 */
export function useRouteOrigin(): { lat: number; lng: number } | null {
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(
    null
  );

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let cancelled = false;
    (async () => {
      try {
        const status = await navigator.permissions.query({
          name: "geolocation",
        });
        if (cancelled || status.state !== "granted") return;
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (!cancelled) {
              setOrigin({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
              });
            }
          },
          () => {
            // 取得失敗(タイムアウト等)はoriginなしのままにする
          },
          // 地図の現在地表示(GeolocateControl)が直近に取った位置があればそれで足りる
          { maximumAge: 60_000, timeout: 10_000 }
        );
      } catch {
        // permissions APIが無い環境では従来どおりoriginなし
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return origin;
}
