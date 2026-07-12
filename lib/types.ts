/**
 * rank/categoryはスポットの「種類(SpotType)」ごとに意味が異なりうるため、
 * DB上は自由入力(nullable text)。以下は観光地(spot_type='tourist')が実際に
 * 使っている値で、UIのサジェスト(datalist)用の参考値として残している。
 * 他の種類(郵便局・御朱印など)は独自のrank/categoryを使うか、全く使わなくてよい。
 */
export type Rank = string;
export type Category = string;

/**
 * 観光地(tourist)のランクはWikipedia(ja)月次ページビュー数を知名度の指標とし、
 * 全スポット中の相対順位(パーセンタイル)で機械的に区分している
 * (世界遺産・国宝等の指定がある場所は目視で格上げする例外あり)。
 * S: 上位5%(全国的に絶対外せない) / A: 次15%(全国区で有名) /
 * B: 次30%(地方の定番) / C: 次30%(地元で知られている) / D: 残り20%(穴場)
 */
export const RANKS: Rank[] = ["S", "A", "B", "C", "D"];

export const RANK_LABELS: Record<string, string> = {
  S: "S: 絶対外せない",
  A: "A: 全国区で有名",
  B: "B: 地方の定番",
  C: "C: 地元で知られている",
  D: "D: 穴場・マニアック",
  Z: "Z: 未整理(Wikipedia情報なし・地図では既定で非表示)",
  郵便局: "郵便局",
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

/** values配列から null/空文字を除いた重複なしリストを返す(rank/categoryのサジェスト用) */
export function distinctValues(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v))).sort();
}

export type DatePrecision = "day" | "month" | "year" | "unknown";

export const DATE_PRECISIONS: { value: DatePrecision; label: string }[] = [
  { value: "day", label: "日まで分かる" },
  { value: "month", label: "年月まで" },
  { value: "year", label: "年だけ" },
  { value: "unknown", label: "覚えていない" },
];

/**
 * published: 公開 / pending: 承認待ち / rejected: 却下(承認操作専用、作成時には選べない) /
 * private: 非公開。誰でも作成できるが、作成者本人にしか見えず口コミも使えない
 */
export type SpotStatus = "published" | "pending" | "rejected" | "private";

export const STATUS_LABELS: Record<SpotStatus, string> = {
  published: "公開",
  pending: "承認待ち",
  rejected: "却下",
  private: "非公開",
};

export interface Spot {
  id: string;
  spot_type_id: string;
  name: string;
  name_kana: string | null;
  prefecture: string;
  municipality: string | null;
  lat: number;
  lng: number;
  rank: Rank | null;
  category: Category | null;
  description: string | null;
  official_url: string | null;
  source: "manual" | "opendata" | "user_submitted";
  status: SpotStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** スポットの種類(観光地/郵便局/御朱印など)。管理者が新規追加できる */
export interface SpotType {
  id: string;
  key: string;
  label: string;
  reviews_enabled: boolean;
  /** 既定では取得・表示しないランク(GET /api/spotsはincludeHidden指定がない限りこれらを返さない) */
  hidden_ranks: string[];
  created_at: string;
}

/**
 * admin: 承認・削除・ユーザー管理・公開スポットの直接作成ができる /
 * moderator: スポットを非公開・承認待ちで追加できる /
 * user: 一般ユーザー(訪問記録の閲覧・記録に加え、非公開スポットの追加ができる)
 */
export type Role = "admin" | "moderator" | "user";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "管理者",
  moderator: "モデレーター",
  user: "一般ユーザー",
};

/** スポット作成時にroleごとに選べるstatus(rejectedは承認操作専用なのでどのroleにも含めない) */
export const ALLOWED_STATUS_BY_ROLE: Record<Role, SpotStatus[]> = {
  user: ["private"],
  moderator: ["private", "pending"],
  admin: ["private", "pending", "published"],
};

export interface AppUser {
  id: string;
  email: string;
  nickname: string | null;
  role: Role;
  has_password: boolean;
  has_google: boolean;
  created_at: string;
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

/** 訪問予定(行きたい場所のブックマーク)。訪問を記録すると自動で消える */
export interface VisitPlan {
  id: string;
  user_id: string;
  spot_id: string;
  created_at: string;
}

/** 口コミ投稿1件(投稿するたびに新しく増える。編集・upsertはしない) */
export interface Review {
  id: string;
  spot_id: string;
  body: string;
  visibility: "public" | "private";
  created_at: string;
}

/** 他ユーザーにも見える公開口コミ一覧表示用(新しい順・ページング) */
export interface PublicReview {
  id: string;
  body: string;
  created_at: string;
  user_name: string;
}

export const REVIEWS_PAGE_SIZE = 10;

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
