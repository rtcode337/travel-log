import type { Category, SpotType } from "./types";

/**
 * カテゴリごとの「地図ピンの形」設定(lib/seriesStyle.tsのカテゴリ版)。
 *
 * シリーズが色・大きさ・ラベルを握っているので、カテゴリに握らせるのは**形だけ**にする。
 * 色や大きさも許すと、シリーズ(重要度)や訪問済みの緑と喧嘩して、どちらが効いているのか
 * 読めない見た目になる。形はそれらと直交していて、最小のピン(size 12)でも見分けられる。
 *
 * 用途の例は「その場所がどういう種類か」ではなく「立ち寄るのに手間がかかるか」のような、
 * シリーズとは別の軸をひと目で見せたいとき(観光地の`じっくり`など)。
 *
 * 1スポットは複数カテゴリを持てる(パイプ区切り)ので、**設定の配列順で最初に一致した
 * ものを採用**する(シリーズの配列順が並び順を決めているのと同じ考え方)。定義の無い
 * カテゴリしか持たないスポットは既定の丸のまま。
 *
 * spot_type_settingsの'category_styles'キーにJSON文字列として保存する
 * (series_styles・categoriesと同じく、値がbooleanでないためSpotTypeSettingKeyの
 * 仕組みとは別扱い)。
 */

/** ピンの頭の形。増やすときはlib/pinIcon.tsの描画にも分岐を足すこと */
export const PIN_SHAPES = ["circle", "rounded-square"] as const;
export type PinShape = (typeof PIN_SHAPES)[number];

/** 設定が無いカテゴリ・設定そのものが無い種別で使う形 */
export const DEFAULT_PIN_SHAPE: PinShape = "circle";

export interface CategoryStyleDefinition {
  category: string;
  shape: PinShape;
}

/** spot_type_settingsにおける、カテゴリの見た目設定を保存するキー(値はJSON文字列) */
export const CATEGORY_STYLES_SETTING_KEY = "category_styles";

/**
 * 既定は「何も定義しない」。カテゴリでの形分けは使いたい種別だけが設定するもので、
 * シリーズ(未設定なら観光地のA〜Eにフォールバックする)とは性質が違う。
 */
export const DEFAULT_CATEGORY_STYLES: CategoryStyleDefinition[] = [];

export function isPinShape(v: unknown): v is PinShape {
  return typeof v === "string" && (PIN_SHAPES as readonly string[]).includes(v);
}

export function isValidCategoryStyle(v: unknown): v is CategoryStyleDefinition {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.category !== "string" || !o.category) return false;
  return isPinShape(o.shape);
}

/** JSON文字列を安全にCategoryStyleDefinition[]としてparseする。不正なら null(空配列は有効) */
export function parseCategoryStyles(json: string): CategoryStyleDefinition[] | null {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || !parsed.every(isValidCategoryStyle)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * スポット種別のsettingsから、カテゴリごとの形の設定を解決する。
 * 未設定・不正な値の場合は空配列(=すべて既定の丸)。
 */
export function resolveCategoryStyles(
  type: Pick<SpotType, "settings"> | null | undefined
): CategoryStyleDefinition[] {
  const raw = type?.settings?.[CATEGORY_STYLES_SETTING_KEY];
  if (raw === undefined) return DEFAULT_CATEGORY_STYLES;
  return parseCategoryStyles(raw) ?? DEFAULT_CATEGORY_STYLES;
}

/**
 * スポットのカテゴリ群から、使うピンの形を決める。
 * 設定の配列順で最初に一致したものを採用し、どれにも当たらなければ既定の丸。
 */
export function findPinShape(
  categories: Category[] | null | undefined,
  styles: CategoryStyleDefinition[]
): PinShape {
  if (!categories || categories.length === 0 || styles.length === 0) {
    return DEFAULT_PIN_SHAPE;
  }
  const found = styles.find((s) => categories.includes(s.category));
  return found ? found.shape : DEFAULT_PIN_SHAPE;
}
