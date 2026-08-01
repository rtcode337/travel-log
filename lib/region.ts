import { PREFECTURES, type SpotType } from "./types";

/**
 * スポット種別ごとの「対象地域」設定(region_scope)。series_stylesと同じく
 * boolean以外の値を持つためSpotTypeSettingKeyとは別扱いで、spot_type_settingsに
 * 文字列としてそのまま保存する。値は次の3種類:
 * - 'jp'(既定): 従来どおり日本。spots.region には47都道府県が入り、
 *   入力UIもPREFECTURESのセレクトボックスになる
 * - ISO 3166-1 alpha-2の国コード小文字('us'など): その国が対象。
 *   spots.region にはその国の州・県(Nominatimのstate/province相当)が入る
 * - 'world': 世界全体が対象。spots.region には国名が入る
 * いずれのスコープでも同じ spots.region 列を使い、「この種別における地域区分」
 * として読み替える。
 */
export const REGION_SCOPE_SETTING_KEY = "region_scope";
export const DEFAULT_REGION_SCOPE = "jp";

/**
 * スポット種別ごとのWikipedia言語版('ja'既定)。wikipedia_enabledな種別で
 * スポット情報モーダルが参照する https://<lang>.wikipedia.org を切り替える。
 * こちらも文字列値のためspot_type_settingsに直接保存する。
 */
export const WIKIPEDIA_LANG_SETTING_KEY = "wikipedia_lang";
export const DEFAULT_WIKIPEDIA_LANG = "ja";

/**
 * スポット詳細のWikipedia検索が「何の名前」で記事を探すかの設定。
 * - 'name'(既定): 従来どおりスポット名で探す
 * - 'series': そのスポットのシリーズ名で探す。アニメの聖地のように
 *   **1つの作品が各地に複数のスポットを持ち、開きたい記事は場所ではなく作品**
 *   という種別向け。シリーズ名の記事が見つからないときはスポット名にフォールバックする
 *   (作品に紐づかない施設のような、シリーズ名が記事にならない行があるため)
 */
export const WIKIPEDIA_TITLE_SOURCE_SETTING_KEY = "wikipedia_title_source";
export const DEFAULT_WIKIPEDIA_TITLE_SOURCE = "name";
export const WIKIPEDIA_TITLE_SOURCES = ["name", "series"] as const;
export type WikipediaTitleSource = (typeof WIKIPEDIA_TITLE_SOURCES)[number];

export function isValidWikipediaTitleSource(value: string): boolean {
  return (WIKIPEDIA_TITLE_SOURCES as readonly string[]).includes(value);
}

/** 種別のsettingsからWikipedia検索の起点を解決する。未設定・不正な値は'name' */
export function resolveWikipediaTitleSource(
  type: Pick<SpotType, "settings"> | null | undefined
): WikipediaTitleSource {
  const raw = type?.settings?.[WIKIPEDIA_TITLE_SOURCE_SETTING_KEY];
  if (raw === undefined || !isValidWikipediaTitleSource(raw))
    return DEFAULT_WIKIPEDIA_TITLE_SOURCE;
  return raw as WikipediaTitleSource;
}

export function isValidRegionScope(value: string): boolean {
  return value === "world" || /^[a-z]{2}$/.test(value);
}

/** Wikipediaのサブドメインとして使える形か('ja'、'zh-yue'のような形式のみ許可) */
export function isValidWikipediaLang(value: string): boolean {
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(value);
}

/** 種別のsettingsから対象地域スコープを解決する。未設定・不正な値は'jp' */
export function resolveRegionScope(
  type: Pick<SpotType, "settings"> | null | undefined
): string {
  const raw = type?.settings?.[REGION_SCOPE_SETTING_KEY];
  if (raw === undefined || !isValidRegionScope(raw)) return DEFAULT_REGION_SCOPE;
  return raw;
}

/** 種別のsettingsからWikipedia言語を解決する。未設定・不正な値は'ja' */
export function resolveWikipediaLang(
  type: Pick<SpotType, "settings"> | null | undefined
): string {
  const raw = type?.settings?.[WIKIPEDIA_LANG_SETTING_KEY];
  if (raw === undefined || !isValidWikipediaLang(raw)) return DEFAULT_WIKIPEDIA_LANG;
  return raw;
}

/**
 * spots.region列の「この種別での呼び名」。フォームのラベル・一覧の見出し等に使う
 * (国指定スコープの区分は国によって州・省・県などまちまちなため「州・県」で総称する)
 */
export function regionFieldLabel(scope: string): string {
  if (scope === "jp") return "都道府県";
  if (scope === "world") return "国";
  return "州・県";
}

/** ISO国コードの日本語名(Intl.DisplayNames)。解決できなければコードを大文字で返す */
export function countryDisplayName(code: string): string {
  try {
    const name = new Intl.DisplayNames(["ja"], { type: "region" }).of(
      code.toUpperCase()
    );
    if (name && name !== code.toUpperCase()) return name;
  } catch {
    // 不正なコード・非対応環境はフォールバックへ
  }
  return code.toUpperCase();
}

/** スコープ自体の表示名(管理画面用)。'jp'→日本、'world'→世界、国コード→国名 */
export function regionScopeDisplayName(scope: string): string {
  if (scope === "jp") return "日本";
  if (scope === "world") return "世界";
  return countryDisplayName(scope);
}

const prefectureOrder = new Map(PREFECTURES.map((p, i) => [p as string, i]));

/**
 * 地域名の一覧表示用の並び順。'jp'はJIS順(PREFECTURESの並び。リスト外の値=
 * 過去データや海外座標の混入分も消さず末尾に五十音順で出す)、それ以外は五十音順
 */
export function compareRegions(a: string, b: string, scope: string): number {
  if (scope === "jp") {
    const ai = prefectureOrder.get(a) ?? PREFECTURES.length;
    const bi = prefectureOrder.get(b) ?? PREFECTURES.length;
    if (ai !== bi) return ai - bi;
  }
  return a.localeCompare(b, "ja");
}
