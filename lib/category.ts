import type { Category, SpotType } from "./types";

/**
 * スポット種別ごとの「使うカテゴリの一覧」設定。series_styles(lib/seriesStyle.ts)と
 * 同じく値がbooleanではないためSpotTypeSettingKeyの仕組みとは別扱いで、
 * spot_type_settingsの'categories'キーにJSON文字列(string[])として保存する。
 * 配列の並び順がそのまま絞り込みチップ・サジェストの並び順になる。
 * 未設定・parse失敗時はDEFAULT_CATEGORIES(観光地が当初使っていたカテゴリ)にフォールバックする。
 */
export const CATEGORIES_SETTING_KEY = "categories";

/**
 * カテゴリ一覧を設定していない種別の既定値(旧lib/types.tsのCATEGORIESハードコードの後継)。
 * **観光地(tourist)が当初使っていた一覧をそのまま残したもので、「観光地の現行カテゴリ」ではない**
 * —— 分類の軸はシリーズへ移り、いまの観光地は categories を空配列で明示している。
 * spots.categories列自体は自由入力のままで、この一覧に無い値も動作はする
 * (並び順は一覧の後ろになる)
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
 * 未設定・不正な値の場合はDEFAULT_CATEGORIESを返す。
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

/**
 * CSV・入力欄で複数カテゴリを1つの値として書くときの区切り文字。
 * カンマはCSVの区切りと衝突して値全体の引用が必要になるため、パイプにしてある
 * (travel-log-data側のspots.csv・訪問記録エクスポートのZIP内CSVも同じ表記)
 */
export const CATEGORY_SEPARATOR = "|";

/**
 * 「自然|夜景|展望」のような1つの文字列を、空要素・重複・前後空白を除いた
 * カテゴリの配列にする。読みやすさのため区切りの前後に空白があってもよい
 */
export function parseCategoryList(raw: string | null | undefined): Category[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(CATEGORY_SEPARATOR)
        .map((c) => c.trim())
        .filter((c) => c !== "")
    )
  );
}

/** parseCategoryListの逆。CSV出力・入力欄の初期値に使う */
export function formatCategoryList(values: Category[]): string {
  return values.join(CATEGORY_SEPARATOR);
}

/** スポットが持つカテゴリを、種別のカテゴリ設定の並び順に整列して返す(表示用) */
export function sortCategories(
  values: Category[],
  categories: Category[]
): Category[] {
  return [...values].sort(
    (a, b) => getCategoryOrder(a, categories) - getCategoryOrder(b, categories)
  );
}

/**
 * スポットのカテゴリを一覧・詳細の1行に収める表示文字列にする
 * (種別の設定順に整列し、中黒で連結。カテゴリ無しは空文字)
 */
export function formatCategoriesForDisplay(
  values: Category[],
  categories: Category[]
): string {
  return sortCategories(values, categories).join("・");
}

/** 2つのカテゴリ配列が(順序を問わず)同じ内容かどうか。CSVインポートの差分判定用 */
export function sameCategories(a: Category[], b: Category[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}
