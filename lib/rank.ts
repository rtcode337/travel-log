/**
 * ランク = スポットの重要度・知名度の段階(A〜E と「なし」)。
 * **地図ピン・バッジの色と大きさだけを決める**、アプリに決め打ちの軸。
 *
 * かつてはこれをシリーズ(`spots.series`)として持ち、色・大きさ・ラベルを
 * 種別ごとのJSON設定(`series_styles`)で定義していた。分けたのは、**同じ「シリーズ」に
 * 「A〜Eの段階」と「作品・企画の名前」という性質の違う2つの使い方が同居していた**ため
 * —— 前者は種別をまたいで同じ意味(Aは一番大きく目立つ)なので決め打ちでよく、
 * 後者は種別ごとに中身が違うので設定で持つしかない。
 *
 * - 値は `spots.rank`(A〜E か null=なし)
 * - **なしはBと同じ大きさ・白**(小さくすると「まだ決めていない」ものが埋もれる)
 * - **種別ごとに使うかどうかを選べる**(`rank_enabled`。既定は使わない)。
 *   使わない種別ではランクは常になし扱いで、**大きさはB相当・色はシリーズが決める**
 */
export const RANKS = ["A", "B", "C", "D", "E"] as const;
export type Rank = (typeof RANKS)[number];

/** ランクなしを絞り込みチップ等で表すときの値・表示名 */
export const NO_RANK = "none";
export const NO_RANK_LABEL = "なし";

export interface RankStyle {
  /** 面の色 */
  color: string;
  /** 縁取り線の色(非公開スポットはこの色のまま破線になる) */
  borderColor: string;
  /** 地図ピンの大きさ(px) */
  size: number;
  /** 中身(シリーズのラベル・アイコン)の色 */
  textColor: string;
}

/**
 * A〜Eの見た目。**色は上から赤・オレンジ・青・緑・黄**で、暖色ほど上のランクになるよう並べる
 * (旧シリーズ設定から引き継いだ並びは琥珀・緑・青・黄・灰で、どれが上のランクか色から読み取れなかった)。
 * 中身の文字はAだけ白にして、最高ランクを他と見分けやすくしている。
 * 大きさは旧設定(26 / 22 / 18 / 15 / 12)から底上げしてある —— Eの12pxは地図上で点にしか見えず、
 * ピンの中のアイコンも潰れていた。段の差は詰めて全体を上げてある。
 */
export const RANK_STYLES: Record<Rank, RankStyle> = {
  A: { color: "#f87171", borderColor: "#dc2626", size: 30, textColor: "#ffffff" },
  B: { color: "#fdba74", borderColor: "#f97316", size: 26, textColor: "#7c2d12" },
  C: { color: "#93c5fd", borderColor: "#60a5fa", size: 23, textColor: "#1e3a8a" },
  D: { color: "#a7f3d0", borderColor: "#34d399", size: 20, textColor: "#065f46" },
  E: { color: "#fef3c7", borderColor: "#fbbf24", size: 18, textColor: "#78350f" },
};

/**
 * ランクなし(未設定)の見た目。**大きさはBと同じ**で色は白。
 * ランクを使わない種別の大きさもこれを使う(色はシリーズが決めるので上書きされる)。
 */
export const NO_RANK_STYLE: RankStyle = {
  color: "#ffffff",
  borderColor: "#9ca3af",
  size: RANK_STYLES.B.size,
  textColor: "#374151",
};

/** ランクの絞り込みで選べる値(A〜E と「なし」) */
export type RankFilterValue = Rank | typeof NO_RANK;

export function isRank(value: unknown): value is Rank {
  return typeof value === "string" && (RANKS as readonly string[]).includes(value);
}

/**
 * 外から来た値(CSV・API・フォーム)をランクに寄せる。小文字も受け、
 * A〜E以外(空文字・別の記号)は「なし」= null にする。
 * **黙って別の値を保存しない**ための入口。
 */
export function parseRank(value: unknown): Rank | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return isRank(upper) ? upper : null;
}

/** ランクの見た目(なしはNO_RANK_STYLE) */
export function rankStyleOf(rank: Rank | null): RankStyle {
  return rank ? RANK_STYLES[rank] : NO_RANK_STYLE;
}

/** 並び順(A→E→なし)。Array.sort用 */
export function rankOrder(rank: Rank | null): number {
  return rank ? RANKS.indexOf(rank) : RANKS.length;
}
