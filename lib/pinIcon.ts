import type maplibregl from "maplibre-gl";
import type { Rank } from "./types";
import { getRankPinStyle, getRankPinTextColor } from "./rankStyle";

/**
 * 地図ピン(下が三角にとんがった吹き出し型)の画像をcanvasで生成し、
 * MapLibreのスタイル画像として登録する。とんがりの先端が画像の下端中央に
 * 来るように描くので、symbolレイヤー側は `icon-anchor: "bottom"` で使う。
 * 縁取りは付けず、代わりに薄い影で地図から浮かせる。
 */

const PIXEL_RATIO = 2;
/**
 * 影のにじみが切れないよう画像の周囲に取る余白(CSS px)。
 * この分だけとんがりの先端が画像下端から浮くので、symbolレイヤー側は
 * `icon-offset: [0, PIN_ICON_PAD]` で押し下げて先端を座標に合わせる
 */
export const PIN_ICON_PAD = 3;

/** とんがり部分の高さ(頭の円のサイズに比例、最低5px) */
export function pinTailHeight(size: number): number {
  return Math.max(5, Math.round(size * 0.45));
}

export function pinIconId(rank: Rank | null, visited: boolean): string {
  return `pin-${visited ? "visited" : "normal"}-${rank ?? "__null__"}`;
}

/** ピン画像を(未登録なら)生成して登録し、そのIDを返す。冪等 */
export function ensurePinImage(
  map: maplibregl.Map,
  rank: Rank | null,
  visited: boolean
): string {
  const id = pinIconId(rank, visited);
  if (map.hasImage(id)) return id;

  const { size, bg } = getRankPinStyle(rank);
  // 訪問済みは(ランクの色より視認性を優先し)ピン全体を緑+チェックマークにする
  const fill = visited ? "#16a34a" : bg;
  const label = visited ? "✓" : rank === "郵便局" ? "〒" : (rank ?? "");
  const textColor = visited ? "#ffffff" : getRankPinTextColor(rank);

  const tail = pinTailHeight(size);
  const w = size + PIN_ICON_PAD * 2;
  const h = size + tail + PIN_ICON_PAD * 2;
  const canvas = document.createElement("canvas");
  canvas.width = w * PIXEL_RATIO;
  canvas.height = h * PIXEL_RATIO;
  const ctx = canvas.getContext("2d");
  if (!ctx) return id;
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);

  const r = size / 2;
  const cx = w / 2;
  const cy = PIN_ICON_PAD + r; // 頭(円)の中心
  const tipY = h - PIN_ICON_PAD; // とんがりの先端(画像下端中央)

  // 円の下側±45°の2点からとんがりの先端へ直線を引いた吹き出し型
  ctx.beginPath();
  ctx.arc(cx, cy, r, (3 * Math.PI) / 4, Math.PI / 4);
  ctx.lineTo(cx, tipY);
  ctx.closePath();
  // shadow系プロパティはscale()の影響を受けないため実ピクセルで指定する
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 2 * PIXEL_RATIO;
  ctx.shadowOffsetY = 1 * PIXEL_RATIO;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = "transparent";

  if (label) {
    // rankは自由入力で複数文字もありうるので、その場合は少し小さくして収める
    const fontSize = Math.max(
      8,
      Math.round(size * (label.length > 1 ? 0.38 : 0.6))
    );
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = textColor;
    ctx.fillText(label, cx, cy + fontSize * 0.05);
  }

  map.addImage(
    id,
    ctx.getImageData(0, 0, canvas.width, canvas.height),
    { pixelRatio: PIXEL_RATIO }
  );
  return id;
}
