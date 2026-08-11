import type { Series, SpotType } from "./types";
import {
  isPinShape,
  isValidPinPath,
  PIN_ICON_VIEW_SIZE,
  type PinIconSpec,
} from "./pinShape";

/**
 * 「シリーズ」= 1スポットが**最大1つ**持つ、種別ごとに定義するまとまり
 * (観光地の`神社仏閣`、アニメ聖地の作品名、水曜どうでしょうの企画名など)。
 * ルート(`spot_routes.series`)の色分けにも同じ値を使う。
 *
 * **シリーズが決めるのは「中身」(ラベル・アイコン)と「形」**で、
 * **大きさはランク**(`lib/rank.ts`)が決める。
 * **色はシリーズに指定があればそちらが勝つ**(`color`/`borderColor`/`textColor`)——
 * 作品ごとに色を分けたうえで知名度を大きさで示す、のように**ランクと色を別の軸に
 * 使いたい種別がある**ため。指定が無ければランクの色になる。
 *
 * かつてはシリーズが色・大きさ・ラベルの全部を握り、A〜Eの段階付けもシリーズとして
 * 表していた。段階付けを**ランク**として切り出したので、シリーズは
 * 「何のスポットか」だけを表す軸になっている(`lib/rank.ts`の冒頭も参照)。
 *
 * 見た目・並び順は`spot_type_settings`の`series_styles`キー(JSON文字列)に持つ。
 * **未設定の種別は空**(=シリーズ定義なし)で、スポットに入っている値はそのまま
 * 動く(ラベルはシリーズ名、色は既定のグレー)。
 */

/** ラベルは文字列、または画像(data URL形式のbase64)のどちらかを指定できる */
export type SeriesLabel = string | { image: string };

export interface SeriesStyleDefinition {
  series: string;
  /** バッジ・ピンの中に出すラベル(文字列 or 画像)。`icon`があるときは使わない */
  label?: SeriesLabel;
  /**
   * バッジ・ピンの中に描くアイコン(SVGのパス。既定では24×24の箱)。
   * `label`より優先する —— 2つ描くと小さいピンでは潰れるため
   */
  icon?: string;
  /**
   * `icon`のパスが描かれている正方形の一辺(SVGの`viewBox`の大きさ)。既定は24。
   * **配布されているアイコンのSVGは`viewBox`がまちまち**(24・48・1000など)なので、
   * パスを書き換えずにそのまま貼れるようにここで指定する。
   */
  iconViewSize?: number;
  /** 組み込みのピンの形(`PIN_SHAPES`)。`path`を書いたときは省略できる */
  shape?: string;
  /** 自前のピンの形(SVGのパス。100×145の箱に描く)。`shape`より優先する */
  path?: string;
  /** 面の色。**指定があればランクの色より優先される**(`lib/spotStyle.ts`) */
  color?: string;
  /** 縁取り線の色。`color`を指定したときに一緒に使う */
  borderColor?: string;
  /** 中身の色。省略時はcolorの明度から自動で白/濃色を選ぶ(画像ラベルの場合は無視) */
  textColor?: string;
}

/** spot_type_settingsにおける、シリーズ設定を保存するキー(値はJSON文字列) */
export const SERIES_STYLES_SETTING_KEY = "series_styles";

/**
 * **既定はシリーズ定義なし**。かつては観光地のA〜Eを既定にしていたが、
 * A〜Eはランクへ移したので「どの種別にも当てはまる既定のシリーズ」は無くなった。
 */
export const DEFAULT_SERIES_STYLES: SeriesStyleDefinition[] = [];

/**
 * シリーズ未設定(null/空)のスポットを画面で指すときの名前。
 * 絞り込みチップ・バッジのツールチップに出す(DBには保存しない)。
 * **見た目は「中身なし」**で、色はランク(ランクを使わない種別では白)。
 */
export const UNSET_SERIES = "未設定";

/** #rrggbb形式の色の明度から、読みやすい文字色(白 or 濃灰)を選ぶ */
export function autoTextColor(hexColor: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hexColor);
  if (!m) return "#111827";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  // per ITU-R BT.601の簡易輝度計算
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111827" : "#ffffff";
}

export function isValidSeriesStyle(v: unknown): v is SeriesStyleDefinition {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.series !== "string" || !o.series) return false;
  if (o.label !== undefined && typeof o.label !== "string") {
    if (
      typeof o.label !== "object" ||
      o.label === null ||
      typeof (o.label as { image?: unknown }).image !== "string"
    ) {
      return false;
    }
  }
  if (o.icon !== undefined && !isValidPinPath(o.icon)) return false;
  if (
    o.iconViewSize !== undefined &&
    (typeof o.iconViewSize !== "number" ||
      !Number.isFinite(o.iconViewSize) ||
      o.iconViewSize <= 0)
  ) {
    return false;
  }
  if (o.path !== undefined && !isValidPinPath(o.path)) return false;
  if (o.shape !== undefined && !isPinShape(o.shape)) return false;
  for (const key of ["color", "borderColor", "textColor"]) {
    if (o[key] !== undefined && typeof o[key] !== "string") return false;
  }
  // sizeはランクへ移したので受け取っても無視する(古い設定ファイルをそのまま
  // 読めるよう、値があること自体はエラーにしない)
  return true;
}

/** JSON文字列を安全にSeriesStyleDefinition[]としてparseする。不正なら null */
export function parseSeriesStyles(json: string): SeriesStyleDefinition[] | null {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || !parsed.every(isValidSeriesStyle)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * スポット種別のsettingsから、そのシリーズ設定(見た目+並び順)を解決する。
 * 未設定・不正な値の場合は空配列(=シリーズ定義なし)。
 */
export function resolveSeriesStyles(
  type: Pick<SpotType, "settings"> | null | undefined
): SeriesStyleDefinition[] {
  const raw = type?.settings?.[SERIES_STYLES_SETTING_KEY];
  if (raw === undefined) return DEFAULT_SERIES_STYLES;
  return parseSeriesStyles(raw) ?? DEFAULT_SERIES_STYLES;
}

/**
 * series文字列に対応する定義を探す。一覧に無い非空のシリーズは
 * 「ラベル=シリーズ名」のフォールバック、未設定(null/空)はnullを返す
 * (呼び出し側が「中身なし」として扱う)。
 *
 * **フォールバックに色は持たせない。** 色を入れるとランクの色を上書きしてしまい
 * (色はシリーズが優先されるため)、定義を書き忘れたシリーズだけランクの色から
 * 外れる —— 定義が無いことは中身(シリーズ名がそのまま出る)で分かる。
 */
export function findSeriesStyle(
  series: Series | null,
  styles: SeriesStyleDefinition[]
): SeriesStyleDefinition | null {
  if (series === null || series === "" || series === UNSET_SERIES) return null;
  return styles.find((s) => s.series === series) ?? { series, label: series };
}

/** アイコン(解決済み)。無ければnull */
export function seriesIconOf(
  style: SeriesStyleDefinition | null
): PinIconSpec | null {
  if (!style?.icon) return null;
  return { path: style.icon, viewSize: style.iconViewSize ?? PIN_ICON_VIEW_SIZE };
}

/** シリーズの並び順(styles配列の順→未知の値→null の順)。Array.sort用 */
export function getSeriesOrder(
  series: Series | null,
  styles: SeriesStyleDefinition[]
): number {
  if (series === null) return styles.length + 1;
  const idx = styles.findIndex((s) => s.series === series);
  return idx === -1 ? styles.length : idx;
}

/** ラベルが画像かどうかの判定 */
export function isImageLabel(label: SeriesLabel): label is { image: string } {
  return typeof label === "object" && label !== null;
}
