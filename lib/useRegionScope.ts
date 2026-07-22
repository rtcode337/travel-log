"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { resolveRegionScope } from "@/lib/region";

/**
 * URLの[type]に対応するスポット種別の対象地域スコープ('jp' | 国コード | 'world')を
 * 取得するhook(useSeriesStylesと同じ作り。/api/spot-typesはGETキャッシュされるため
 * 重複リクエストにはならない)。取得が終わるまではnullを返すので、既定値が必要な
 * 場面では `?? DEFAULT_REGION_SCOPE` で受けること(取得完了を待ちたい処理は
 * null判定でスキップできるよう、あえて既定値では埋めない)。
 */
export function useRegionScope(typeKey: string): string | null {
  const [scope, setScope] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.spotTypes.list().then(({ data }) => {
      if (cancelled) return;
      const type = data?.find((t) => t.key === typeKey);
      setScope(resolveRegionScope(type));
    });
    return () => {
      cancelled = true;
    };
  }, [typeKey]);

  return scope;
}
