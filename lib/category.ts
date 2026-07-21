import type { Category, SpotType } from "./types";

/**
 * スポット種別ごとの「使うカテゴリの一覧」設定。rank_styles(lib/rankStyle.ts)と
 * 同じく値がbooleanではないためSpotTypeSettingKeyの仕組みとは別扱いで、
 * spot_type_settingsの'categories'キーにJSON文字列(string[])として保存する。
 * 配列の並び順がそのまま絞り込みチップ・サジェストの並び順になる。
 * 未設定・parse失敗時はDEFAULT_CATEGORIES(観光地の現行カテゴリ)にフォールバックする。
 */
export const CATEGORIES_SETTING_KEY = "categories";

/**
 * 観光地(tourist)が実際に使っているカテゴリをそのまま既定値として使う
 * (旧lib/types.tsのCATEGORIESハードコードの後継)。category列自体は自由入力の
 * ままで、この一覧に無い値も動作はする(並び順は一覧の後ろになる)
 */
export const DEFAULT_CATEGORIES: Category[] = [
  "神社仏閣",
  "自然",
  "城",
  "温泉",
  "街並み",
  "美術館博物館",
  "その他",
];

/** 空でない文字列の配列(=カテゴリ一覧として使える形)か検証する */
export function isValidCategoryList(v: unknown): v is Category[] {
  return (
    Array.isArray(v) && v.every((c) => typeof c === "string" && c.trim() !== "")
  );
}

/** JSON文字列を安全にCategory[]としてparseする。不正なら null(空配列は有効) */
export function parseCategories(json: string): Category[] | null {
  try {
    const parsed = JSON.parse(json);
    return isValidCategoryList(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * スポット種別のsettingsから、そのカテゴリ一覧(並び順込み)を解決する。
 * 未設定・不正な値の場合は観光地のカテゴリ(DEFAULT_CATEGORIES)を返す。
 * 明示的に空配列("[]")を保存した種別は「定義済みカテゴリなし」の扱いになる
 */
export function resolveCategories(
  type: Pick<SpotType, "settings"> | null | undefined
): Category[] {
  const raw = type?.settings?.[CATEGORIES_SETTING_KEY];
  if (raw === undefined) return DEFAULT_CATEGORIES;
  return parseCategories(raw) ?? DEFAULT_CATEGORIES;
}

/** カテゴリの並び順(categories配列の順→未知の値→null の順)。Array.sort用 */
export function getCategoryOrder(
  category: Category | null,
  categories: Category[]
): number {
  if (category === null) return categories.length + 1;
  const idx = categories.indexOf(category);
  return idx === -1 ? categories.length : idx;
}
