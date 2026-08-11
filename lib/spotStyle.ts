import type { Series } from "./types";
import { NO_RANK_STYLE, rankStyleOf, type Rank, type RankStyle } from "./rank";
import {
  autoTextColor,
  findSeriesStyle,
  isImageLabel,
  seriesIconOf,
  type SeriesStyleDefinition,
} from "./seriesStyle";
import {
  DEFAULT_PIN_SHAPE,
  isPinShape,
  type PinIconSpec,
  type PinShapeSpec,
} from "./pinShape";

/**
 * スポットの見た目を、**ランクとシリーズの2つだけ**から組み立てる場所。
 * 地図ピン(`lib/pinIcon.ts`)・バッジ(`components/SpotBadge.tsx`)・ミニ地図が
 * 同じ答えを使うようにする —— 別々に決めていると、同じスポットが地図と一覧で
 * 違う見た目になって対応が取れなくなる。
 *
 * | 決めるもの | 出どころ |
 * |---|---|
 * | 色・大きさ | **ランク**(`lib/rank.ts`。決め打ち) |
 * | 形・中身(アイコン/ラベル) | **シリーズ**(`series_styles`) |
 * | 色(ランクを使わない種別) | **シリーズ**(`color`/`borderColor`/`textColor`) |
 *
 * 訪問済み(緑+✓)・非公開(破線)はこの上に描画側が重ねる。
 */

/** ピン・バッジの「面」 */
export type SpotFace = RankStyle;

/** ピン・バッジの「中身」 */
export type SpotMark =
  | { kind: "icon"; icon: PinIconSpec }
  | { kind: "text"; text: string }
  | { kind: "image"; src: string }
  | { kind: "none" };

/**
 * 面(色・大きさ)を決める。
 * **ランクを使う種別**はランクがそのまま面になる(シリーズの色は無視)。
 * **使わない種別**は大きさをランクなし相当に固定し、色だけシリーズから取る
 * (シリーズ未設定・色の指定なしはランクなしの白)。
 */
export function resolveSpotFace(
  rank: Rank | null,
  series: Series | null,
  seriesStyles: SeriesStyleDefinition[],
  rankEnabled: boolean
): SpotFace {
  if (rankEnabled) return rankStyleOf(rank);
  const style = findSeriesStyle(series, seriesStyles);
  const color = style?.color ?? NO_RANK_STYLE.color;
  return {
    color,
    borderColor: style?.borderColor ?? NO_RANK_STYLE.borderColor,
    size: NO_RANK_STYLE.size,
    textColor: style?.textColor ?? autoTextColor(color),
  };
}

/** 中身(アイコン → ラベル → 無し)を決める。シリーズ未設定なら中身なし */
export function resolveSpotMark(
  series: Series | null,
  seriesStyles: SeriesStyleDefinition[]
): SpotMark {
  const style = findSeriesStyle(series, seriesStyles);
  const icon = seriesIconOf(style);
  if (icon) return { kind: "icon", icon };
  const label = style?.label;
  if (label === undefined) return { kind: "none" };
  if (isImageLabel(label)) return { kind: "image", src: label.image };
  return label ? { kind: "text", text: label } : { kind: "none" };
}

/** ピンの形を決める(`path`が`shape`より優先。どちらも無ければ丸) */
export function resolveSpotShape(
  series: Series | null,
  seriesStyles: SeriesStyleDefinition[]
): PinShapeSpec {
  const style = findSeriesStyle(series, seriesStyles);
  if (style?.path) return { path: style.path };
  return isPinShape(style?.shape) ? style.shape : DEFAULT_PIN_SHAPE;
}

/**
 * 中身そのものを表す短い文字列。地図ピンの画像IDに混ぜて、**中身が変われば別の画像**に
 * なるようにする(ピン画像は一度登録すると作り直されないため)。
 * 長い値(自前のパス・base64の画像)は呼び出し側でハッシュにする。
 */
export function spotMarkKey(mark: SpotMark): string {
  switch (mark.kind) {
    case "icon":
      return `i${mark.icon.viewSize}|${mark.icon.path}`;
    case "text":
      return `t${mark.text}`;
    case "image":
      return `m${mark.src}`;
    case "none":
      return "n";
  }
}

/**
 * シリーズの絞り込みチップの見た目。**ここだけはランクを見ない** ——
 * チップが表しているのはスポットではなくシリーズそのものなので、
 * 色はシリーズの指定(無ければ既定)を使う。中身はスポットと同じ解決を通す。
 */
export function resolveSeriesChip(
  series: Series | null,
  seriesStyles: SeriesStyleDefinition[]
): { face: SpotFace; mark: SpotMark } {
  return {
    face: resolveSpotFace(null, series, seriesStyles, false),
    mark: resolveSpotMark(series, seriesStyles),
  };
}
