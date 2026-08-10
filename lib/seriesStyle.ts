import type { Series, SpotType } from "./types";

/**
 * 「シリーズ」= 1スポットが必ず1つだけ持つ、種別ごとに定義するまとまり。
 * 観光地のA〜E(知名度の段階)のような序列にも、序列を持たない並列の区分にも
 * 使えるよう、値は自由入力にしてある
 * (かつては「ランク」という名前だったが、序列でない使い方が増えて実態に
 * 合わなくなったため改名した)。地図ピン・バッジの色分けの単位であり、
 * ルート(spot_routes.series)の色分けにも同じ値を使う。
 *
 * 見た目・並び順は元々SeriesBadge/MapView/MiniMap/FilterBarの4箇所に個別に
 * コピペされていた(観光地A〜E専用の配色)。スポット種別が増えてseriesが自由入力に
 * なったことに合わせて1箇所にまとめ、さらにスポット種別ごとにJSON設定
 * (spot_type_settingsの'series_styles'キー、JSON文字列)でシリーズの一覧と見た目を
 * カスタマイズできるようにしている。設定が無い種別(観光地作成当初・画面から手入力で
 * 追加した種別など)はDEFAULT_SERIES_STYLES(観光地のA〜E)にフォールバックする。
 */

/** ラベルは文字列、または画像(data URL形式のbase64)のどちらかを指定できる */
export type SeriesLabel = string | { image: string };

export interface SeriesStyleDefinition {
  series: string;
  /** 背景色(バッジ・ピン共通) */
  color: string;
  /** 縁取り線の色(バッジ・ピン共通。非公開スポットはこの色のまま破線になる) */
  borderColor: string;
  /** 地図ピンの大きさ(px)。バッジの大小はこの値と無関係(sizeプロパティで別管理) */
  size: number;
  /** バッジ・ピンに表示するラベル(文字列 or 画像) */
  label: SeriesLabel;
  /** ラベル文字の色。省略時はcolorの明度から自動で白/濃色を選ぶ(画像ラベルの場合は無視) */
  textColor?: string;
}

/** spot_type_settingsにおける、シリーズ設定を保存するキー(値はJSON文字列) */
export const SERIES_STYLES_SETTING_KEY = "series_styles";

/**
 * 観光地の現行A〜E配色をそのままデフォルト値として使う
 * (このファイルの旧BADGE_STYLES/PIN_STYLES/PIN_TEXT_COLORSより)。
 *
 * 観光地(tourist)のA〜EはWikipedia(ja)月次ページビュー数を知名度の指標とし、
 * 全スポット中の相対順位(パーセンタイル)で機械的に区分したもの
 * (世界遺産・国宝等の指定がある場所は目視で格上げする例外あり)。
 * 最上位をSにすると運用上何かと面倒なため、A〜Eの5段階にしている。
 * A: 上位5%(全国的に絶対外せない) / B: 次15%(全国区で有名) /
 * C: 次30%(地方の定番) / D: 次30%(地元で知られている) / E: 残り20%(穴場)
 */
export const DEFAULT_SERIES_STYLES: SeriesStyleDefinition[] = [
  { series: "A", color: "#f59e0b", borderColor: "#b45309", size: 26, label: "A", textColor: "#451a03" },
  { series: "B", color: "#a7f3d0", borderColor: "#34d399", size: 22, label: "B", textColor: "#065f46" },
  { series: "C", color: "#93c5fd", borderColor: "#60a5fa", size: 18, label: "C", textColor: "#1e3a8a" },
  { series: "D", color: "#fef3c7", borderColor: "#fbbf24", size: 15, label: "D", textColor: "#78350f" },
  { series: "E", color: "#e5e7eb", borderColor: "#9ca3af", size: 12, label: "E", textColor: "#374151" },
];

/** 種別のシリーズ一覧に無い(未知の)シリーズ文字列用のフォールバック見た目 */
const UNKNOWN_SERIES_STYLE: SeriesStyleDefinition = {
  series: "",
  color: "#f3f4f6",
  borderColor: "#d1d5db",
  size: 16,
  label: "",
  textColor: "#6b7280",
};

/**
 * シリーズ未設定(null/空)のスポットに与える仮想シリーズ。非公開スポット以外は
 * シリーズ必須なので、実際に付くのは主に自分の非公開スポット。
 * 見た目は**白いピンに青い丸**。DBには保存せず、描画時にのみ適用する。
 *
 * かつては「マイスポット」という名前で赤ピン+白丸にしていたが、
 * **未設定はあくまで未設定**であって別の分類ではないので、名前を「未設定」に戻し、
 * 見た目も**シリーズの文字を持たないこと自体が分かる**白+丸にした
 * (赤は地名検索のマーカーとも色が被っていた)。丸をラベル画像で置くのは、
 * 文字のラベル(A〜E)と同じ枠に収まり、バッジ表示にもそのまま使えるため。
 */
export const UNSET_SERIES = "未設定";

/** 青丸のラベル画像(白ピンの中に置く) */
const UNSET_DOT_IMAGE =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Ccircle%20cx='12'%20cy='12'%20r='8'%20fill='%232563eb'/%3E%3C/svg%3E";

const UNSET_SERIES_STYLE: SeriesStyleDefinition = {
  series: UNSET_SERIES,
  color: "#ffffff",
  borderColor: "#9ca3af",
  size: 26,
  label: { image: UNSET_DOT_IMAGE },
};

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
  if (typeof o.color !== "string") return false;
  if (typeof o.borderColor !== "string") return false;
  if (typeof o.size !== "number") return false;
  if (typeof o.label !== "string") {
    if (
      typeof o.label !== "object" ||
      o.label === null ||
      typeof (o.label as { image?: unknown }).image !== "string"
    ) {
      return false;
    }
  }
  if (o.textColor !== undefined && typeof o.textColor !== "string") return false;
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
 * 未設定・不正な値の場合は観光地のA〜E(DEFAULT_SERIES_STYLES)を返す
 */
export function resolveSeriesStyles(
  type: Pick<SpotType, "settings"> | null | undefined
): SeriesStyleDefinition[] {
  const raw = type?.settings?.[SERIES_STYLES_SETTING_KEY];
  if (raw === undefined) return DEFAULT_SERIES_STYLES;
  return parseSeriesStyles(raw) ?? DEFAULT_SERIES_STYLES;
}

/**
 * series文字列に対応するスタイルを探す。シリーズ未設定(null/空文字)は
 * 白ピン+青丸。種別の一覧に無い非空のシリーズは
 * UNKNOWN_SERIES_STYLE(labelはseriesそのもの)。
 */
export function findSeriesStyle(
  series: Series | null,
  styles: SeriesStyleDefinition[]
): SeriesStyleDefinition {
  if (series === null || series === "" || series === UNSET_SERIES) {
    return UNSET_SERIES_STYLE;
  }
  return styles.find((s) => s.series === series) ?? { ...UNKNOWN_SERIES_STYLE, series, label: series };
}

/** シリーズの並び順(styles配列の順→未知の値→null の順)。Array.sort用 */
export function getSeriesOrder(series: Series | null, styles: SeriesStyleDefinition[]): number {
  if (series === null) return styles.length + 1;
  const idx = styles.findIndex((s) => s.series === series);
  return idx === -1 ? styles.length : idx;
}

/** ラベルが画像かどうかの判定 */
export function isImageLabel(label: SeriesLabel): label is { image: string } {
  return typeof label === "object" && label !== null;
}
