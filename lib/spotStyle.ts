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
 *
 * - **大きさはランク**。使わない種別はランクなし相当で固定
 * - **色はシリーズに指定があればそれを優先**し、無ければランクの色
 *
 * 色をシリーズに譲るのは、**ランクと色を別の軸に使いたい種別がある**ため ——
 * アニメ聖地は「作品ごとに色を分けたうえで、知名度で大きさを変えたい」。
 * かつてはランクを使う種別ではランクの色で塗り切っていたが、それだと
 * シリーズの色を設定しても黙って無視されていた。
 * 観光地のようにシリーズが色を持たない種別は、今までどおりランクの色になる。
 */
export function resolveSpotFace(
  rank: Rank | null,
  series: Series | null,
  seriesStyles: SeriesStyleDefinition[],
  rankEnabled: boolean
): SpotFace {
  const base = rankEnabled ? rankStyleOf(rank) : NO_RANK_STYLE;
  const style = findSeriesStyle(series, seriesStyles);
  if (!style?.color) return base;
  return {
    color: style.color,
    borderColor: style.borderColor ?? base.borderColor,
    size: base.size,
    textColor: style.textColor ?? autoTextColor(style.color),
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
