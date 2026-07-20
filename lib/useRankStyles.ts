"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import {
  DEFAULT_RANK_STYLES,
  resolveRankStyles,
  type RankStyleDefinition,
} from "@/lib/rankStyle";

/**
 * URLの[type]に対応するスポット種別のランク設定(見た目+並び順)を取得するhook。
 * `/api/spot-types`はapi-client側でGETキャッシュされるため、同じページ内で
 * 複数コンポーネントがこのhookを使っても重複リクエストにはならない。
 * 取得前・見つからない・設定が無い場合は観光地のA〜E(DEFAULT_RANK_STYLES)を返す
 */
export function useRankStyles(typeKey: string): RankStyleDefinition[] {
  const [styles, setStyles] = useState<RankStyleDefinition[]>(DEFAULT_RANK_STYLES);

  useEffect(() => {
    api.spotTypes.list().then(({ data }) => {
      const type = data?.find((t) => t.key === typeKey);
      setStyles(resolveRankStyles(type));
    });
  }, [typeKey]);

  return styles;
}
