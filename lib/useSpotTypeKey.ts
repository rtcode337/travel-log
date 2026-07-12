"use client";

import { usePathname } from "next/navigation";

const TYPED_ROUTE = /^\/([^/]+)\/(?:map|spots)(?:\/|$)/;

/**
 * 現在のURLが /[type]/map や /[type]/spots のような形式ならそのtypeキーを返す。
 * /map・/spots(型キー無し、app_settingsの既定を使うルート)なら undefined。
 * リンクやタブ遷移で今のスポット種類を保つために使う。
 */
export function useCurrentSpotTypeKey(): string | undefined {
  const pathname = usePathname();
  return pathname.match(TYPED_ROUTE)?.[1];
}
