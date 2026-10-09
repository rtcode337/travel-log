import type { Category, Series } from "./types";
import type { Rank } from "./rank";
import { formatCategoriesForDisplay } from "./category";

/**
 * スポット名の下に出す1行(地域 ・ ランク ・ シリーズ ・ カテゴリ)。
 * **詳細モーダルと一覧で同じものを出す**ため1か所にまとめてある ——
 * 別々に組むと、片方だけ項目が増えたり区切りの規則がずれたりする。
 * ただし**一覧ではカテゴリを出さない**(`includeCategories: false`)。カテゴリは複数付くので
 * 行が折り返して一覧の1件が縦に伸びる。カテゴリは詳細モーダルで見る。
 *
 * **無い項目は落としてから繋ぐ**。空文字を挟むと区切りだけが残るため
 * (カテゴリを使わない種別で、末尾に「・」が居座っていた)。
 * ランクは「ランクC」ではなく「C」だけにする(前後の項目と語調をそろえる)。
 */
export function formatSpotMeta(
  spot: {
    region: string;
    rank?: Rank | null;
    series?: Series | null;
    categories?: Category[];
  },
  options: {
    /** その種別がランクを使うか。使わないならランクは出さない */
    rankEnabled?: boolean;
    /** 種別のカテゴリ設定(並び順に使う) */
    categories?: Category[];
    /** falseで地域を出さない(都道府県の中の一覧など、見出しに出ているとき) */
    includeRegion?: boolean;
    /** falseでカテゴリを出さない(一覧。折り返して幅を取るため) */
    includeCategories?: boolean;
  } = {}
): string {
  return [
    options.includeRegion === false ? null : spot.region,
    options.rankEnabled ? spot.rank : null,
    spot.series,
    options.includeCategories !== false && spot.categories
      ? formatCategoriesForDisplay(spot.categories, options.categories ?? [])
      : null,
  ]
    .filter((v): v is string => !!v)
    .join(" ・ ");
}
