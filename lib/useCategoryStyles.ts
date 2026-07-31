"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import {
  DEFAULT_CATEGORY_STYLES,
  resolveCategoryStyles,
  type CategoryStyleDefinition,
} from "@/lib/categoryStyle";

/**
 * URLの[type]に対応するスポット種別の、カテゴリごとのピンの形の設定を取得するhook
 * (useSeriesStyles.tsのカテゴリ版)。`/api/spot-types`はapi-client側でGETキャッシュ
 * されるため、同じページ内で複数コンポーネントがこのhookを使っても重複リクエストには
 * ならない。取得前・見つからない・設定が無い場合は空配列(=すべて既定の丸)を返す。
 */
export function useCategoryStyles(typeKey: string): CategoryStyleDefinition[] {
  const [styles, setStyles] = useState<CategoryStyleDefinition[]>(DEFAULT_CATEGORY_STYLES);

  useEffect(() => {
    api.spotTypes.list().then(({ data }) => {
      const type = data?.find((t) => t.key === typeKey);
      setStyles(resolveCategoryStyles(type));
    });
  }, [typeKey]);

  return styles;
}
