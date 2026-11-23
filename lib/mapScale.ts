/**
 * 地図の縮尺(目盛りの付いた物差し)の数字を決める。描くのは components/MapScaleControl.ts。
 *
 * 紙の地図によくある「0 ・ 500 ・ 1000m」の形にする —— 端と真ん中に数字、間に細かい目盛り。
 * 数字はここで決め、地図に依らない純粋な関数にしてある(テストできるように)。
 */

/** 物差しを細かく刻む数(10 → 端と真ん中の間に 4 本ずつ細かい目盛り) */
export const SCALE_DIVISIONS = 10;

/**
 * 物差しの全長として使う距離(m)。**`maxMeters` 以下で、切りのよい値**
 * (1・2・5 × 10 のべき乗)のうち最大のもの。0 以下や数でないときは 0。
 */
export function niceScaleMeters(maxMeters: number): number {
  if (!Number.isFinite(maxMeters) || maxMeters <= 0) return 0;
  const power = 10 ** Math.floor(Math.log10(maxMeters));
  const leading = maxMeters / power;
  const step = leading >= 5 ? 5 : leading >= 2 ? 2 : 1;
  return step * power;
}

/**
 * 物差しの数字(真ん中と右端)。**単位は右端にだけ付ける**(「0 ・ 500 ・ 1000m」)。
 * 2km 未満はメートル(1000m まではメートルで読むほうが馴染む)、それ以上はキロメートル。
 */
export function scaleLabels(meters: number): { half: string; full: string } {
  const inKm = meters >= 2000;
  const value = inKm ? meters / 1000 : meters;
  const unit = inKm ? "km" : "m";
  return { half: formatNumber(value / 2), full: `${formatNumber(value)}${unit}` };
}

// 小数は 1 桁まで、末尾の 0 は落とす。全長は 1・2・5 × 10 のべき乗なので、
// 真ん中は 0.5・1・2.5 の 10 倍ずつにしかならず、1 桁で足りる
function formatNumber(value: number): string {
  return String(Math.round(value * 10) / 10);
}
