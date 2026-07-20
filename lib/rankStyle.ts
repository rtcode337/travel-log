import type { Rank } from "./types";

/**
 * ランクの見た目・並び順は元々 RankBadge/MapView/MiniMap/FilterBar の4箇所に
 * 個別にコピペされていた(観光地のS〜D専用の配色)。スポット種別が増えて
 * rank が自由入力になったことに合わせて1箇所にまとめ、未知の値やnullには
 * 無難なデフォルトを返すようにしている。
 */

const KNOWN_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, Z: 5, 郵便局: 6 };
const UNKNOWN_ORDER = Object.keys(KNOWN_ORDER).length;
const NULL_ORDER = UNKNOWN_ORDER + 1;

/** ランクの並び順(A〜E→既知の他の値→null の順)。Array.sort用 */
export function getRankOrder(rank: Rank | null): number {
  if (rank === null) return NULL_ORDER;
  return KNOWN_ORDER[rank] ?? UNKNOWN_ORDER;
}

const BADGE_STYLES: Record<string, string> = {
  A: "bg-[#f59e0b] text-[#451a03]",
  B: "bg-[#a7f3d0] text-[#065f46]",
  C: "bg-[#93c5fd] text-[#1e3a8a]",
  D: "bg-[#fef3c7] text-[#78350f] border border-[#fde68a]",
  E: "bg-[#e5e7eb] text-gray-700",
  Z: "bg-[#6b7280] text-white",
  郵便局: "bg-[#dc2626] text-white",
};
const DEFAULT_BADGE_STYLE = "bg-gray-100 text-gray-600 border border-gray-300";

/** RankBadge・FilterBarのランク選択ボタンで使うバッジ配色 */
export function getRankBadgeStyle(rank: Rank | null): string {
  if (rank === null) return DEFAULT_BADGE_STYLE;
  return BADGE_STYLES[rank] ?? DEFAULT_BADGE_STYLE;
}

const PIN_COLORS: Record<string, string> = {
  A: "#f59e0b",
  B: "#a7f3d0",
  C: "#93c5fd",
  D: "#fef3c7",
  E: "#e5e7eb",
  Z: "#6b7280",
  郵便局: "#dc2626",
};
const DEFAULT_PIN_COLOR = "#9ca3af";

/** MiniMapのマーカー色 */
export function getRankPinColor(rank: Rank | null): string {
  if (rank === null) return DEFAULT_PIN_COLOR;
  return PIN_COLORS[rank] ?? DEFAULT_PIN_COLOR;
}

interface PinStyle {
  size: number;
  bg: string;
  border: string;
}

const PIN_STYLES: Record<string, PinStyle> = {
  A: { size: 26, bg: "#f59e0b", border: "#b45309" },
  B: { size: 22, bg: "#a7f3d0", border: "#34d399" },
  C: { size: 18, bg: "#93c5fd", border: "#60a5fa" },
  D: { size: 15, bg: "#fef3c7", border: "#fbbf24" },
  E: { size: 12, bg: "#e5e7eb", border: "#9ca3af" },
  Z: { size: 10, bg: "#6b7280", border: "#374151" },
  郵便局: { size: 22, bg: "#dc2626", border: "#b91c1c" },
};
const DEFAULT_PIN_STYLE: PinStyle = { size: 16, bg: "#9ca3af", border: "#6b7280" };

/** MapViewの地図ピンのサイズ・色(上位ランクほど大きく目立つ) */
export function getRankPinStyle(rank: Rank | null): PinStyle {
  if (rank === null) return DEFAULT_PIN_STYLE;
  return PIN_STYLES[rank] ?? DEFAULT_PIN_STYLE;
}

// PIN_STYLESの背景色に合わせた文字色(BADGE_STYLESのtext-*と同じ配色)。
// B/C/D/Eは背景が薄いので白文字だと読めないため、濃い色にしている
const PIN_TEXT_COLORS: Record<string, string> = {
  A: "#451a03",
  B: "#065f46",
  C: "#1e3a8a",
  D: "#78350f",
  E: "#374151",
  Z: "#ffffff",
  郵便局: "#ffffff",
};
const DEFAULT_PIN_TEXT_COLOR = "#ffffff";

/** MapViewの地図ピンに表示するランク文字の色(ピン背景とのコントラスト確保用) */
export function getRankPinTextColor(rank: Rank | null): string {
  if (rank === null) return DEFAULT_PIN_TEXT_COLOR;
  return PIN_TEXT_COLORS[rank] ?? DEFAULT_PIN_TEXT_COLOR;
}
