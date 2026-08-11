import type { Series } from "@/lib/types";
import type { Rank } from "@/lib/rank";
import { UNSET_SERIES, type SeriesStyleDefinition } from "@/lib/seriesStyle";
import { resolveSpotFace, resolveSpotMark } from "@/lib/spotStyle";
import SpotMarkGlyph from "@/components/SpotMarkGlyph";

/**
 * スポットの丸いバッジ(一覧・詳細・経路のスポット名の隣に出す印)。
 * **地図ピンと同じ`lib/spotStyle.ts`から見た目を組む** ——
 * 色はランク(ランクを使わない種別ではシリーズ)、中身はシリーズのアイコンか文字。
 * どちらも無いスポットは色だけの丸になる。
 *
 * かつては`SeriesBadge`という名前でシリーズだけを表していたが、色の出どころが
 * ランクへ移ったので「スポットの印」に改名した。
 */
export default function SpotBadge({
  rank,
  series,
  seriesStyles,
  rankEnabled = false,
  size = "md",
  isPrivate = false,
}: {
  rank: Rank | null;
  series: Series | null;
  /** このスポットが属するスポット種別のシリーズ設定(lib/useSeriesStyles.ts参照) */
  seriesStyles: SeriesStyleDefinition[];
  /** その種別がランクを使うか(lib/useRankEnabled.ts参照)。使わないなら色はシリーズ由来 */
  rankEnabled?: boolean;
  size?: "sm" | "md";
  /** 非公開スポットは縁取り線が破線になる(色・中身はそのまま) */
  isPrivate?: boolean;
}) {
  const face = resolveSpotFace(rank, series, seriesStyles, rankEnabled);
  const mark = resolveSpotMark(series, seriesStyles);
  // ツールチップ。ランクを使う種別ではランクも添える(中身はシリーズなので、
  // 色だけではどの段階か読み取れない人がいるため)
  const seriesLabel = series && series.length > 0 ? series : UNSET_SERIES;
  const title = rankEnabled ? `${seriesLabel}(ランク ${rank ?? "なし"})` : seriesLabel;

  return (
    <span
      // shrink-0: 長いスポット名などと横並びになったときにバッジが潰れて中身が
      // 欠けるのを防ぐ(バッジは常に中身の幅を保ち、隣の要素側で折り返す)
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-full px-1.5 font-bold ${
        size === "sm" ? "h-5 min-w-5 text-xs" : "h-6 min-w-6 text-sm"
      }`}
      style={{
        backgroundColor: face.color,
        color: face.textColor,
        border: `1.5px ${isPrivate ? "dashed" : "solid"} ${face.borderColor}`,
      }}
      title={title}
    >
      <SpotMarkGlyph
        mark={mark}
        alt={seriesLabel}
        className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"}
      />
    </span>
  );
}
