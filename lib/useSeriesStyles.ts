"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import {
  DEFAULT_SERIES_STYLES,
  resolveSeriesStyles,
  type SeriesStyleDefinition,
} from "@/lib/seriesStyle";

/**
 * URLの[type]に対応するスポット種別のシリーズ設定(見た目+並び順)を取得するhook。
 * `/api/spot-types`はapi-client側でGETキャッシュされるため、同じページ内で
 * 複数コンポーネントがこのhookを使っても重複リクエストにはならない。
 * 取得前・見つからない・設定が無い場合は空(=シリーズ定義なし)を返す
 */
export function useSeriesStyles(typeKey: string): SeriesStyleDefinition[] {
  const [styles, setStyles] = useState<SeriesStyleDefinition[]>(DEFAULT_SERIES_STYLES);

  useEffect(() => {
    api.spotTypes.list().then(({ data }) => {
      const type = data?.find((t) => t.key === typeKey);
      setStyles(resolveSeriesStyles(type));
    });
  }, [typeKey]);

  return styles;
}
