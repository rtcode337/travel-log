"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { resolveCategories } from "@/lib/category";
import type { Category } from "@/lib/types";

/**
 * URLの[type]に対応するスポット種別のカテゴリ一覧(並び順込み)を取得するhook
 * (useSeriesStyles.tsのカテゴリ版)。`/api/spot-types`はapi-client側でGETキャッシュ
 * されるため、同じページ内で複数コンポーネントがこのhookを使っても重複リクエストには
 * ならない。**取得前・見つからない・設定が無い場合は空**(=定義済みカテゴリなし)
 */
export function useCategories(typeKey: string): Category[] {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    api.spotTypes.list().then(({ data }) => {
      const type = data?.find((t) => t.key === typeKey);
      setCategories(resolveCategories(type));
    });
  }, [typeKey]);

  return categories;
}
