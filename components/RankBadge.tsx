import { RANK_LABELS, type Rank } from "@/lib/types";
import { getRankBadgeStyle } from "@/lib/rankStyle";

export default function RankBadge({
  rank,
  size = "md",
}: {
  rank: Rank | null;
  size?: "sm" | "md";
}) {
  if (rank === null) return null;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full px-1.5 font-bold ${getRankBadgeStyle(
        rank
      )} ${size === "sm" ? "h-5 min-w-5 text-xs" : "h-6 min-w-6 text-sm"}`}
      title={RANK_LABELS[rank] ?? rank}
    >
      {rank}
    </span>
  );
}
