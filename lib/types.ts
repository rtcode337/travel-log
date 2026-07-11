export type Rank = "S" | "A" | "B";

export const RANKS: Rank[] = ["S", "A", "B"];

export const RANK_LABELS: Record<Rank, string> = {
  S: "S: 絶対外せない",
  A: "A: 時間があれば行くべき",
  B: "B: 知る人ぞ知る",
};

export const CATEGORIES = [
  "神社仏閣",
  "自然",
  "城",
  "温泉",
  "街並み",
  "美術館博物館",
  "その他",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type DatePrecision = "day" | "month" | "year" | "unknown";

export const DATE_PRECISIONS: { value: DatePrecision; label: string }[] = [
  { value: "day", label: "日まで分かる" },
  { value: "month", label: "年月まで" },
  { value: "year", label: "年だけ" },
  { value: "unknown", label: "覚えていない" },
];

export interface Spot {
  id: string;
  name: string;
  name_kana: string | null;
  prefecture: string;
  municipality: string | null;
  lat: number;
  lng: number;
  rank: Rank;
  category: Category;
  description: string | null;
  official_url: string | null;
  source: "manual" | "opendata" | "user_submitted";
  status: "published" | "pending" | "rejected";
  created_at: string;
  updated_at: string;
}

export interface Visit {
  id: string;
  user_id: string;
  spot_id: string;
  visited_on: string | null;
  date_precision: DatePrecision;
  memo: string | null;
  photos: string[];
  created_at: string;
}

export const PREFECTURES = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
] as const;

/** 訪問日を精度に応じて表示用文字列にする */
export function formatVisitedOn(
  visitedOn: string | null,
  precision: DatePrecision
): string {
  if (!visitedOn || precision === "unknown") return "時期不明";
  const [y, m, d] = visitedOn.split("-");
  switch (precision) {
    case "day":
      return `${y}年${Number(m)}月${Number(d)}日`;
    case "month":
      return `${y}年${Number(m)}月`;
    case "year":
      return `${y}年`;
  }
}
