import type { Rank, SpotType } from "./types";

/**
 * ランクの見た目・並び順は元々RankBadge/MapView/MiniMap/FilterBarの4箇所に個別に
 * コピペされていた(観光地A〜E専用の配色)。スポット種別が増えてrankが自由入力に
 * なったことに合わせて1箇所にまとめ、さらにスポット種別ごとにJSON設定
 * (spot_type_settingsの'rank_styles'キー、JSON文字列)でランクの一覧と見た目を
 * カスタマイズできるようにしている。設定が無い種別(観光地作成当初・画面から手入力で
 * 追加した種別など)はDEFAULT_RANK_STYLES(観光地のA〜E)にフォールバックする。
 */

/** ラベルは文字列、または画像(data URL形式のbase64)のどちらかを指定できる */
export type RankLabel = string | { image: string };

export interface RankStyleDefinition {
  rank: string;
  /** 背景色(バッジ・ピン共通) */
  color: string;
  /** 縁取り線の色(バッジ・ピン共通。非公開スポットはこの色のまま破線になる) */
  borderColor: string;
  /** 地図ピンの大きさ(px)。バッジの大小はこの値と無関係(sizeプロパティで別管理) */
  size: number;
  /** バッジ・ピンに表示するラベル(文字列 or 画像) */
  label: RankLabel;
  /** ラベル文字の色。省略時はcolorの明度から自動で白/濃色を選ぶ(画像ラベルの場合は無視) */
  textColor?: string;
}

/** spot_type_settingsにおける、ランク設定を保存するキー(値はJSON文字列) */
export const RANK_STYLES_SETTING_KEY = "rank_styles";

/**
 * 観光地の現行A〜E配色をそのままデフォルト値として使う
 * (lib/rankStyle.tsの旧BADGE_STYLES/PIN_STYLES/PIN_TEXT_COLORSより)
 */
export const DEFAULT_RANK_STYLES: RankStyleDefinition[] = [
  { rank: "A", color: "#f59e0b", borderColor: "#b45309", size: 26, label: "A", textColor: "#451a03" },
  { rank: "B", color: "#a7f3d0", borderColor: "#34d399", size: 22, label: "B", textColor: "#065f46" },
  { rank: "C", color: "#93c5fd", borderColor: "#60a5fa", size: 18, label: "C", textColor: "#1e3a8a" },
  { rank: "D", color: "#fef3c7", borderColor: "#fbbf24", size: 15, label: "D", textColor: "#78350f" },
  { rank: "E", color: "#e5e7eb", borderColor: "#9ca3af", size: 12, label: "E", textColor: "#374151" },
];

/** 種別のランク一覧に無い(未知の)ランク文字列用のフォールバック見た目 */
const UNKNOWN_RANK_STYLE: RankStyleDefinition = {
  rank: "",
  color: "#f3f4f6",
  borderColor: "#d1d5db",
  size: 16,
  label: "",
  textColor: "#6b7280",
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

export function isValidRankStyle(v: unknown): v is RankStyleDefinition {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.rank !== "string" || !o.rank) return false;
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

/** JSON文字列を安全にRankStyleDefinition[]としてparseする。不正なら null */
export function parseRankStyles(json: string): RankStyleDefinition[] | null {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || !parsed.every(isValidRankStyle)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * スポット種別のsettingsから、そのランク設定(見た目+並び順)を解決する。
 * 未設定・不正な値の場合は観光地のA〜E(DEFAULT_RANK_STYLES)を返す
 */
export function resolveRankStyles(
  type: Pick<SpotType, "settings"> | null | undefined
): RankStyleDefinition[] {
  const raw = type?.settings?.[RANK_STYLES_SETTING_KEY];
  if (raw === undefined) return DEFAULT_RANK_STYLES;
  return parseRankStyles(raw) ?? DEFAULT_RANK_STYLES;
}

/** rank文字列に対応するスタイルを探す。見つからなければUNKNOWN_RANK_STYLE(labelはrankそのもの) */
export function findRankStyle(
  rank: Rank | null,
  styles: RankStyleDefinition[]
): RankStyleDefinition {
  if (rank === null) return UNKNOWN_RANK_STYLE;
  return styles.find((s) => s.rank === rank) ?? { ...UNKNOWN_RANK_STYLE, rank, label: rank };
}

/** ランクの並び順(styles配列の順→未知の値→null の順)。Array.sort用 */
export function getRankOrder(rank: Rank | null, styles: RankStyleDefinition[]): number {
  if (rank === null) return styles.length + 1;
  const idx = styles.findIndex((s) => s.rank === rank);
  return idx === -1 ? styles.length : idx;
}

/** ラベルが画像かどうかの判定 */
export function isImageLabel(label: RankLabel): label is { image: string } {
  return typeof label === "object" && label !== null;
}
