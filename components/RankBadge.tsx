import type { Rank } from "@/lib/types";

const styles: Record<Rank, string> = {
  S: "bg-amber-400 text-amber-950",
  A: "bg-gray-300 text-gray-800",
  B: "bg-gray-100 text-gray-500 border border-gray-300",
};

export default function RankBadge({
  rank,
  size = "md",
}: {
  rank: Rank;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded font-bold ${
        styles[rank]
      } ${size === "sm" ? "h-5 w-5 text-xs" : "h-6 w-6 text-sm"}`}
      title={`必訪ランク ${rank}`}
    >
      {rank}
    </span>
  );
}
