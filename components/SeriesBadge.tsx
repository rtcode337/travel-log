import type { Series } from "@/lib/types";
import {
  autoTextColor,
  findSeriesStyle,
  isImageLabel,
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
  if (series === null) return null;
  const style = findSeriesStyle(series, seriesStyles);
  const textColor = style.textColor ?? autoTextColor(style.color);

  return (
    <span
      className={`inline-flex items-center justify-center overflow-hidden rounded-full px-1.5 font-bold ${
        size === "sm" ? "h-5 min-w-5 text-xs" : "h-6 min-w-6 text-sm"
      }`}
      style={{
        backgroundColor: style.color,
        color: textColor,
        border: `1.5px ${isPrivate ? "dashed" : "solid"} ${style.borderColor}`,
      }}
      title={series}
    >
      {isImageLabel(style.label) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={style.label.image}
          alt={series}
          className="h-full w-full object-contain"
        />
      ) : (
        style.label
      )}
    </span>
  );
}
