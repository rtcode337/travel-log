import { isValidRankStyle, type RankStyleDefinition } from "./rankStyle";

/**
 * rank/categoryはスポットの「種別(SpotType)」ごとに意味が異なりうるため、
 * DB上は自由入力(nullable text)。以下は観光地(spot_type='tourist')が実際に
 * 使っている値で、UIのサジェスト(datalist)用の参考値として残している。
 * 他の種別は独自のrank/categoryを使うか、全く使わなくてよい。
 */
export type Rank = string;
export type Category = string;

/**
 * 観光地(tourist)のランクはWikipedia(ja)月次ページビュー数を知名度の指標とし、
 * 全スポット中の相対順位(パーセンタイル)で機械的に区分している
 * (世界遺産・国宝等の指定がある場所は目視で格上げする例外あり)。
 * 最上位をSにすると運用上何かと面倒なため、A〜Eの5段階にしている。
 * A: 上位5%(全国的に絶対外せない) / B: 次15%(全国区で有名) /
 * C: 次30%(地方の定番) / D: 次30%(地元で知られている) / E: 残り20%(穴場)
 */
export const RANKS: Rank[] = ["A", "B", "C", "D", "E"];

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
  /** 地域。種別のregion_scope設定により意味が変わる(日本=都道府県、
   * 国指定=州・県、世界=国。lib/region.ts参照)。列名は歴史的にprefectureのまま */
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

/** スポット種別(観光地など)。管理者が新規追加できる */
export interface SpotType {
  id: string;
  key: string;
  label: string;
  /** spot_type_settings(key/value)をオブジェクトにまとめたもの。値は文字列("true"/"false")で、
   * キーが存在しない設定はSPOT_TYPE_SETTING_DEFAULTSの既定値として扱う(getSpotTypeSetting参照) */
  settings: Record<string, string>;
  created_at: string;
}

/**
 * スポット種別ごとのON/OFF設定。spot_typesに列を増やさずに済むよう
 * spot_type_settings(spot_type_id, key, value)のEAV形式でDBに持つ。
 * 新しい設定を増やす際は、ここにキー・既定値・表示名を追加するだけでよい
 * (マイグレーション不要。使う側は getSpotTypeSetting で読む)。
 *
 * public_visible: かつての spot_types.visibility(public/admin_only/disabled の3値)の
 * 後継。既定はfalse — 種別を追加した当初はadmin/spot_admin以外には404/非表示にしておき、
 * 準備が整ってからtrueにして/[key]/map・/[key]/spots・アカウントページのリンクを
 * 全ユーザーに開放する(/[key]/adminは既定値に関わらず常にアクセス可)。
 * disabled相当(誰にも見せない)は種別そのものの削除で代替するため設定としては無くなった。
 */
export type SpotTypeSettingKey =
  | "public_visible"
  | "reviews_enabled"
  | "wikipedia_enabled";

export const SPOT_TYPE_SETTING_DEFAULTS: Record<SpotTypeSettingKey, boolean> = {
  public_visible: false,
  reviews_enabled: true,
  wikipedia_enabled: true,
};

/** 管理画面のチェックボックス・メッセージに使う短い名前(名詞句。
 * 「この種別で{名前}を有効にする」というテンプレートに当てはめて使う) */
export const SPOT_TYPE_SETTING_LABELS: Record<SpotTypeSettingKey, string> = {
  public_visible: "一般公開(管理者以外も閲覧可能にする)",
  reviews_enabled: "口コミ",
  wikipedia_enabled: "Wikipediaリンク",
};

export const SPOT_TYPE_SETTING_KEYS = Object.keys(
  SPOT_TYPE_SETTING_DEFAULTS
) as SpotTypeSettingKey[];

/** type.settings[key]の文字列値からbooleanを解決する。行が無ければ既定値を返す */
export function getSpotTypeSetting(
  type: Pick<SpotType, "settings"> | null | undefined,
  key: SpotTypeSettingKey
): boolean {
  const raw = type?.settings?.[key];
  return raw === undefined ? SPOT_TYPE_SETTING_DEFAULTS[key] : raw === "true";
}

/**
 * スポット種別を管理画面からJSONファイルで一括作成するための定義ファイル形式。
 * travel-log-data(例: `<スポットキー>/settings.json`)にスポットデータのCSVと並べて置く想定
 * (詳細はtravel-log-data/README.md参照)。settingsは省略したキーが既定値のまま
 * (SPOT_TYPE_SETTING_DEFAULTS)になる点はDBのEAV設計と同じ。boolean設定のほか、
 * region_scope('jp'/国コード/'world')・wikipedia_lang('en'等)のような文字列値の
 * 設定もそのまま指定できる(妥当性はPATCH /api/spot-types/[id]側で検証される)。
 * ranksを省略した場合(または画面から手入力で種別を追加した場合)は観光地の
 * A〜E(DEFAULT_RANK_STYLES、lib/rankStyle.ts参照)がそのまま既定のランク設定になる。
 */
export interface SpotTypeDefinitionFile {
  key: string;
  label: string;
  settings?: Partial<Record<string, boolean | string>>;
  ranks?: RankStyleDefinition[];
}

/** JSONをparseした後の値がSpotTypeDefinitionFileとして使える形か検証する */
export function parseSpotTypeDefinition(
  json: unknown
): { data: SpotTypeDefinitionFile } | { error: string } {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { error: "JSONのトップレベルはオブジェクトである必要があります。" };
  }
  const obj = json as Record<string, unknown>;
  if (typeof obj.key !== "string" || !obj.key.trim()) {
    return { error: "key(文字列)が必要です。" };
  }
  if (typeof obj.label !== "string" || !obj.label.trim()) {
    return { error: "label(文字列)が必要です。" };
  }
  if (obj.settings !== undefined) {
    if (typeof obj.settings !== "object" || obj.settings === null || Array.isArray(obj.settings)) {
      return { error: "settingsはオブジェクトである必要があります。" };
    }
    for (const [k, v] of Object.entries(obj.settings as Record<string, unknown>)) {
      if (typeof v !== "boolean" && typeof v !== "string") {
        return {
          error: `settings.${k}はtrue/falseまたは文字列である必要があります。`,
        };
      }
    }
  }
  if (obj.ranks !== undefined) {
    if (!Array.isArray(obj.ranks) || !obj.ranks.every(isValidRankStyle)) {
      return {
        error:
          "ranksは { rank, color, borderColor, size, label, textColor? } の配列である必要があります。",
      };
    }
  }
  return {
    data: {
      key: obj.key.trim(),
      label: obj.label.trim(),
      settings: obj.settings as
        | Partial<Record<string, boolean | string>>
        | undefined,
      ranks: obj.ranks as RankStyleDefinition[] | undefined,
    },
  };
}

/**
 * admin: 承認・削除・ユーザー管理・スポット種別設定・公開スポットの直接作成ができる /
 * spot_admin: ユーザー管理・スポット種別設定はできないが、スポットについてはadminと同じ
 *   権限を持つ(承認待ち→公開/却下への変更、公開スポットの直接作成・編集・削除) /
 * moderator: スポットを非公開・承認待ちで追加できる。承認待ちスポットは全員分閲覧できるが、
 *   承認・却下はできない /
 * user: 一般ユーザー(訪問記録の閲覧・記録に加え、非公開スポットの追加ができる)
 *
 * スポットのstatus別の閲覧・編集ルール(roleに関わらず共通):
 * - private: 追加した本人のみ閲覧・編集(削除含む)可能
 * - pending/rejected: 追加した本人のみ編集可能。admin/spot_admin/moderatorは全件閲覧可能。
 *   pending→published/rejectedへの変更はadmin/spot_adminのみ(本人以外の分も可)
 * - published: 誰でも閲覧可能。編集(削除含む)・新規作成はadmin/spot_adminのみ
 */
export type Role = "admin" | "spot_admin" | "moderator" | "user";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "管理者",
  spot_admin: "スポット管理者",
  moderator: "モデレーター",
  user: "一般ユーザー",
};

/** スポット作成時にroleごとに選べるstatus(rejectedは承認操作専用なのでどのroleにも含めない) */
export const ALLOWED_STATUS_BY_ROLE: Record<Role, SpotStatus[]> = {
  user: ["private"],
  moderator: ["private", "pending"],
  spot_admin: ["private", "pending", "published"],
  admin: ["private", "pending", "published"],
};

/** 承認待ち・却下スポットを(投稿者以外も含めて)全件閲覧できるロール */
export const MODERATION_ROLES: Role[] = ["admin", "spot_admin", "moderator"];

/** 公開スポットの直接作成・編集・削除と、承認待ち→公開/却下への変更ができるロール */
export const SPOT_ADMIN_ROLES: Role[] = ["admin", "spot_admin"];

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

/**
 * visits.photosの1要素を<img src>用のURLにする。現行データはphotosフォルダ内の
 * 相対パス(認証付きの/api/photos/経由で配信)。ファイル保存方式へ移行する前の
 * 旧データ(Base64のdata URL)がDBに残っていることがあり、それはそのまま使う
 */
export function visitPhotoSrc(photo: string): string {
  return photo.startsWith("data:") ? photo : `/api/photos/${photo}`;
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

/** 自分が書いた口コミ一覧表示用(新しい順、投稿先スポットの情報を含む) */
export interface MyReview {
  id: string;
  spot_id: string;
  body: string;
  created_at: string;
  spot_name: string;
  spot_prefecture: string;
  spot_municipality: string | null;
  spot_rank: Rank | null;
}

export const REVIEWS_PAGE_SIZE = 10;

export const SPOTS_PAGE_SIZE = 50;

/**
 * 47都道府県(JIS X 0401順)。region_scopeが'jp'(既定)のスポット種別でのみ
 * 「地域の全集合」として使う(入力セレクトの選択肢・一覧の並び順)。
 * 'jp'以外のスコープでは地域は自由入力で、このリストは参照しない(lib/region.ts参照)
 */
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
