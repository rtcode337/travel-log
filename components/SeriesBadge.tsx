import type { Series } from "@/lib/types";
import {
  autoTextColor,
  findSeriesStyle,
  isImageLabel,
  UNSET_SERIES,
  type SeriesStyleDefinition,
} from "@/lib/seriesStyle";

export default function SeriesBadge({
  series,
  seriesStyles,
  size = "md",
  isPrivate = false,
}: {
  series: Series | null;
  /** このスポットが属するスポット種別のシリーズ設定(lib/useSeriesStyles.ts参照) */
  seriesStyles: SeriesStyleDefinition[];
  size?: "sm" | "md";
  /** 非公開スポットは縁取り線が破線になる(色・大きさ・ラベルはシリーズと同じ) */
  isPrivate?: boolean;
}) {
  // シリーズ未設定(null/空)も「未設定」としてバッジを出す
  const style = findSeriesStyle(series, seriesStyles);
  // 表示名・title用の実効シリーズ名(null/空は「未設定」)
  const effectiveSeries = series && series.length > 0 ? series : UNSET_SERIES;
  const textColor = style.textColor ?? autoTextColor(style.color);

  return (
    <span
      // shrink-0: 長いスポット名などと横並びになったときにバッジが潰れてラベルが
      // 欠けるのを防ぐ(バッジは常にラベルの幅を保ち、隣の要素側で折り返す)
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-full px-1.5 font-bold ${
        size === "sm" ? "h-5 min-w-5 text-xs" : "h-6 min-w-6 text-sm"
      }`}
      style={{
        backgroundColor: style.color,
        color: textColor,
        border: `1.5px ${isPrivate ? "dashed" : "solid"} ${style.borderColor}`,
      }}
      title={effectiveSeries}
    >
      {isImageLabel(style.label) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={style.label.image}
          alt={effectiveSeries}
          className="h-full w-full object-contain"
        />
      ) : (
        style.label
      )}
    </span>
  );
}
