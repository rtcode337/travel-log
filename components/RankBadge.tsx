import type { Rank } from "@/lib/types";
import {
  autoTextColor,
  findRankStyle,
  isImageLabel,
  type RankStyleDefinition,
} from "@/lib/rankStyle";

export default function RankBadge({
  rank,
  rankStyles,
  size = "md",
  isPrivate = false,
}: {
  rank: Rank | null;
  /** このスポットが属するスポット種別のランク設定(lib/useRankStyles.ts参照) */
  rankStyles: RankStyleDefinition[];
  size?: "sm" | "md";
  /** 非公開スポットは縁取り線が破線になる(色・大きさ・ラベルはランクと同じ) */
  isPrivate?: boolean;
}) {
  if (rank === null) return null;
  const style = findRankStyle(rank, rankStyles);
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
      title={rank}
    >
      {isImageLabel(style.label) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={style.label.image}
          alt={rank}
          className="h-full w-full object-contain"
        />
      ) : (
        style.label
      )}
    </span>
  );
}
