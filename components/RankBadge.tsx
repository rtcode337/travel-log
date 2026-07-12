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
      className={`inline-flex items-center justify-center rounded font-bold ${getRankBadgeStyle(
        rank
      )} ${size === "sm" ? "h-5 w-5 text-xs" : "h-6 w-6 text-sm"}`}
      title={RANK_LABELS[rank] ?? rank}
    >
      {rank}
    </span>
  );
}
