"use client";

import {
  buildGoogleMapsRouteUrl,
  GOOGLE_MAPS_MAX_WAYPOINTS,
} from "@/lib/googleMaps";
import { useRouteOrigin } from "@/lib/useRouteOrigin";

/** 経路案内アイコン(Google Material Symbols「directions」、Apache License 2.0) */
export function DirectionsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M22.43 10.59l-9.01-9.01c-.75-.75-2.07-.76-2.83 0l-9 9c-.78.78-.78 2.04 0 2.82l9 9c.39.39.9.58 1.41.58.51 0 1.02-.19 1.41-.58l8.99-8.99c.79-.76.8-2.02.03-2.82zm-10.42 10.4l-9-9 9-9 9 9-9 9zM8 11v4h2v-3h4v2.5l3.5-3.5L14 7.5V10H9c-.55 0-1 .45-1 1z" />
    </svg>
  );
}

/**
 * スポットの並び(ルート・訪問順の経路・訪問予定リスト)全体を、Google マップの
 * 経路検索で開くリンク。**出発地は現在地**で、最後のスポットが目的地、
 * それ以外のスポットが経由地になる。スポットが無いときは何も描かない。
 * Google マップ側の経由地の上限を超えた分は間引かれるため、そのときは
 * 省いた件数を注記する。
 */
export default function GoogleMapsRouteLink({
  points,
  label = "Google マップで経路を表示",
}: {
  /** 巡る順に並んだ地点(スポットの座標) */
  points: { lat: number; lng: number }[];
  label?: string;
}) {
  const origin = useRouteOrigin();
  const route = buildGoogleMapsRouteUrl(points, origin);
  if (!route) return null;
  return (
    <div>
      <a
        href={route.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-blue-600 underline"
      >
        <DirectionsIcon className="size-4 shrink-0" />
        {label}
      </a>
      {route.omittedCount > 0 && (
        <p className="mt-1 text-xs text-gray-500">
          Google マップの経由地は{GOOGLE_MAPS_MAX_WAYPOINTS}件までのため、途中の
          {route.omittedCount}件は省いています(現在地から出発し、最初と最後の
          スポットは変わりません)。
        </p>
      )}
    </div>
  );
}
