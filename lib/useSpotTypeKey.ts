"use client";

import { usePathname } from "next/navigation";

const TYPED_ROUTE = /^\/([^/]+)\/(?:map|spots|admin|account)(?:\/|$)/;

/**
 * 現在のURLが /[type]/map・/[type]/spots・/[type]/admin・/[type]/account のような形式なら
 * そのtypeキーを返す。このアプリのページは必ずこの形式なので、通常はundefinedにならない
 * (ログイン直後の / だけは例外だが、即リダイレクトされるためNavBarには実質現れない)。
 * リンクやタブ遷移で今のスポット種類を保つために使う。
 */
export function useCurrentSpotTypeKey(): string | undefined {
  const pathname = usePathname();
  return pathname.match(TYPED_ROUTE)?.[1];
}
