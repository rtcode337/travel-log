"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { getSpotTypeSetting } from "@/lib/types";

/**
 * URLの[type]に対応するスポット種別が**ランク(A〜E)を使うか**を取得するhook
 * (`useSeriesStyles`と同じ流儀。`/api/spot-types`はapi-client側でGETキャッシュされる)。
 * 取得前・見つからない場合は既定の false(使わない)を返す。
 *
 * 使わない種別ではランクは常になし扱いで、ピンの大きさはランクなし相当・
 * 色はシリーズが決める(`lib/spotStyle.ts`)。
 */
export function useRankEnabled(typeKey: string): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    api.spotTypes.list().then(({ data }) => {
      const type = data?.find((t) => t.key === typeKey);
      setEnabled(getSpotTypeSetting(type, "rank_enabled"));
    });
  }, [typeKey]);

  return enabled;
}
