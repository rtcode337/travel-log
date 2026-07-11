import { RANK_LABELS, type Rank } from "@/lib/types";

const styles: Record<Rank, string> = {
  S: "bg-[#f59e0b] text-[#451a03]",
  A: "bg-[#a7f3d0] text-[#065f46]",
  B: "bg-[#93c5fd] text-[#1e3a8a]",
  C: "bg-white text-gray-700 border border-gray-300",
  D: "bg-[#e5e7eb] text-gray-700",
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
      title={RANK_LABELS[rank]}
    >
      {rank}
    </span>
  );
}
