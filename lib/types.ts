import { isValidSeriesStyle, type SeriesStyleDefinition } from "./seriesStyle";
import { isValidCategoryList } from "./category";
import type { Rank } from "./rank";

/**
 * スポットは見た目と分類に3つの軸を持つ。**それぞれ持てる数と決めるものが違う**:
 *
 * | 軸 | 数 | 値 | 決めるもの |
 * |---|---|---|---|
 * | ランク(`rank`) | 0か1 | A〜E(決め打ち) | 色・大きさ(`lib/rank.ts`) |
 * | シリーズ(`series`) | 0か1 | 種別ごとに自由 | 中身(ラベル・アイコン)と形。ランク未使用の種別では色も(`lib/seriesStyle.ts`) |
 * | カテゴリ(`categories`) | 0個以上 | 種別ごとに自由 | **絞り込みだけ**(見た目には効かない。`lib/category.ts`) |
 *
 * series/categoriesはDB上は自由入力(seriesはnullable text、categoriesはtext[])で、
 * 種別ごとに「使う値の一覧」を設定に持つ(未設定の種別は一覧なし=入っている値が
 * そのまま動く)。ランクだけは種別をまたいで同じ意味なのでアプリに決め打ちで持ち、
 * 使うかどうかだけを種別ごとに選ぶ(`rank_enabled`)。
 */
export type Series = string;
export type Category = string;

/** values配列から null/空文字を除いた重複なしリストを返す(series/categoryのサジェスト用) */
export function distinctValues(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v))).sort();
}

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
  /** CSV等の外部データからこのスポットを参照するための、種別内で一意な省略可のキー
   * (ルートCSVのspot_key列が指す先。db/init/02_spot_key_routes.sql参照) */
  key: string | null;
  name: string;
  name_kana: string | null;
  lat: number;
  lng: number;
  /** 地域。種別のregion_scope設定により意味が変わる(日本=都道府県、
   * 国指定=州・県、世界=国。lib/region.ts参照)。座標から決まる従属値 */
  region: string;
  /** 重要度・知名度の段階(A〜E)。null=なし。種別が`rank_enabled`のときだけ意味を持つ */
  rank: Rank | null;
  series: Series | null;
  /** このスポットが属するカテゴリ(0個以上)。順序に意味は無く、表示・並び順は
   * 種別のカテゴリ設定(lib/category.tsのgetCategoryOrder)に従う */
  categories: Category[];
  description: string | null;
  status: SpotStatus;
  /** 登録経路。csv=CSVインポート(travel-log-data由来)、manual=画面からの手動追加。
   * 手動追加の公開スポットをtravel-log-dataへ還元するエクスポートの抽出条件に使う */
  origin: SpotOrigin;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type SpotOrigin = "csv" | "manual";

/**
 * 画面から個別削除されたCSV由来の公開スポットの記録(削除の墓標)。
 * travel-log-data側のexclude.txtへ追記する候補として還元用エクスポートに出す。
 * created_atが削除日時
 */
export interface SpotDeletion {
  id: string;
  spot_type_id: string;
  key: string | null;
  name: string;
  lat: number;
  lng: number;
  region: string;
  deleted_by: string | null;
  created_at: string;
}

/** ルートの経由地1点。seqの昇順が巡った順(lat/lng/spot_nameは表示用にJOINで付与) */
export interface SpotRoutePoint {
  spot_id: string;
  seq: number;
  lat: number;
  lng: number;
  spot_name: string;
  /**
   * この経由地から次の経由地への区間の説明(移動手段など。未指定ならnull)。
   * 最終地点には次の区間が無いため常にnull。ルート全体の説明はSpotRoute.description
   */
  description: string | null;
}

/**
 * スポットを巡った順に繋ぐルート(地図に描く1本の矢印列)。
 * seriesに種別のシリーズ値を入れると、地図の矢印がそのシリーズの縁取り色で
 * 描かれ、シリーズ絞り込みにも連動する(nullなら既定色で扱う)
 */
export interface SpotRoute {
  id: string;
  spot_type_id: string;
  /** ルートの表示名。シリーズとは独立で、同じシリーズに複数のルートを持たせられる */
  name: string;
  /** このルートが属するシリーズ(spots.seriesと同じ値空間。未指定ならnull) */
  series: string | null;
  /** ルート全体の説明文(地図のルート詳細に表示。未指定ならnull。区間ごとの説明はpoints側) */
  description: string | null;
  /** spotsと同じ公開状態(公開=全員、非公開=作成者のみ、承認待ち・却下=本人+moderator以上) */
  status: SpotStatus;
  created_by: string | null;
  created_at: string;
  /**
   * 経由地の入れ替え(upsert)でも進む。公開スポットキャッシュの鮮度判定
   * (lib/useSpotCache.ts)に使う。旧バージョンで保存したキャッシュ内の
   * ルートには入っていないことがある
   */
  updated_at: string;
  points: SpotRoutePoint[];
}

/** スポット種別(観光地など)。管理者が新規追加できる */
export interface SpotType {
  id: string;
  key: string;
  label: string;
  /** spot_type_settings(key/value)をオブジェクトにまとめたもの。値は文字列("true"/"false")で、
   * キーが存在しない設定はSPOT_TYPE_SETTING_DEFAULTSの既定値として扱う(getSpotTypeSetting参照) */
  settings: Record<string, string>;
  /** 画面に並べる順(小さいほど先)。同じ値なら作成順。管理画面から並び替える */
  sort_order: number;
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
  | "wikipedia_enabled"
  | "rank_enabled";

export const SPOT_TYPE_SETTING_DEFAULTS: Record<SpotTypeSettingKey, boolean> = {
  public_visible: false,
  reviews_enabled: true,
  wikipedia_enabled: true,
  // ランクは「段階を付けたい種別」だけのものなので既定は使わない。
  // 使わない種別ではランクは常になし扱いで、色はシリーズが決める
  rank_enabled: false,
};

/** 管理画面のチェックボックス・メッセージに使う短い名前(名詞句。
 * 「この種別で{名前}を有効にする」というテンプレートに当てはめて使う) */
export const SPOT_TYPE_SETTING_LABELS: Record<SpotTypeSettingKey, string> = {
  public_visible: "一般公開(管理者以外も閲覧可能にする)",
  reviews_enabled: "口コミ",
  wikipedia_enabled: "Wikipediaリンク",
  rank_enabled: "ランク(A〜E。ピンの色と大きさを決める)",
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
 * seriesを省略した場合(または画面から手入力で種別を追加した場合)はシリーズ定義なし
 * (lib/seriesStyle.ts)、categoriesを省略した場合は観光地の現行カテゴリ
 * (DEFAULT_CATEGORIES、lib/category.ts参照)が既定になる。
 */
export interface SpotTypeDefinitionFile {
  key: string;
  label: string;
  settings?: Partial<Record<string, boolean | string>>;
  series?: SeriesStyleDefinition[];
  categories?: Category[];
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
  if (obj.series !== undefined) {
    if (!Array.isArray(obj.series) || !obj.series.every(isValidSeriesStyle)) {
      return {
        error:
          "seriesは { series, label?, icon?, iconViewSize?, shape?, path?, color?, borderColor?, textColor? } の配列である必要があります。",
      };
    }
  }
  if (obj.categories !== undefined && !isValidCategoryList(obj.categories)) {
    return {
      error: "categoriesは空でない文字列の配列である必要があります。",
    };
  }
  return {
    data: {
      key: obj.key.trim(),
      label: obj.label.trim(),
      settings: obj.settings as
        | Partial<Record<string, boolean | string>>
        | undefined,
      series: obj.series as SeriesStyleDefinition[] | undefined,
      categories: obj.categories as Category[] | undefined,
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
/**
 * 訪問記録エクスポートのジョブ(`export_jobs`)。管理者が対象ユーザーを指定して
 * 実行し、生成はバックグラウンドで進む。ファイルの実パスはAPIから返さない
 * (ダウンロードは `/api/exports/[id]/download` 経由)
 */
export interface ExportJob {
  id: string;
  /** エクスポートの対象ユーザー */
  user_id: string;
  user_email: string;
  /** 実行した管理者(アカウントを削除するとnull) */
  requested_by: string | null;
  status: "running" | "done" | "failed";
  file_size: number | null;
  visit_count: number | null;
  photo_count: number | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

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
  /** 訪問日時(timestamptz。JSONではISO 8601文字列)。不明ならnull */
  visited_on: string | null;
  memo: string | null;
  photos: string[];
  /**
   * trueなら「未訪問記録」: 訪問したが休みや時間の都合でちゃんと見られなかった
   * (visited_onあり=その日の訪問順の経路には含まれ、訪問予定も外れる)、または
   * 事前の下調べのメモ(visited_onなし=訪問予定は外れない)。どちらも訪問済みの
   * 判定(ピンの緑色・訪問状況の絞り込み)には数えず、それ以外の扱い(写真・メモ・
   * 編集・一覧)は通常の訪問記録と同じ
   */
  unvisited: boolean;
  created_at: string;
}

/** 訪問済みの判定(ピンの緑色・訪問状況の絞り込み・✓件数)に数える訪問記録だけを返す
 * (未訪問記録=unvisitedの行を除く) */
export function countedVisits(visits: Visit[]): Visit[] {
  return visits.filter((v) => !v.unvisited);
}

/**
 * visits.photosの1要素(photosフォルダ内の相対パス)を<img src>用のURLにする。
 * 実体の配信は認証付きの/api/photos/経由
 */
export function visitPhotoSrc(photo: string): string {
  return `/api/photos/${photo}`;
}

/**
 * 非表示スポット。公開スポットのうち「自分は興味がない」ものをユーザーごとに
 * 地図・一覧から隠す設定(スポット自体には影響しない)。visit_plansと同じトグル管理
 */
export interface SpotHide {
  id: string;
  user_id: string;
  spot_id: string;
  created_at: string;
}

/** 訪問予定(行きたい場所のブックマーク)。訪問を記録すると自動で消える */
export interface VisitPlan {
  id: string;
  user_id: string;
  spot_id: string;
  created_at: string;
}

/**
 * 訪問予定リスト(旅程)。複数スポットを順序付きでまとめたもの。種別ごとに紐づき、
 * 1スポットごとの visit_plans とは独立(詳細はmigrations/006)。
 * `spot_ids`はseq順の経由スポットのUUID(スポット詳細は呼び出し側が保持済みの一覧から解決)。
 */
export interface VisitPlanList {
  id: string;
  spot_type_id: string;
  title: string;
  description: string | null;
  /** 訪問予定期間(`YYYY-MM-DD`)。終了日未入力時は開始日と同じ(=単日) */
  start_date: string;
  end_date: string;
  /** 経由スポット(seq順)。訪問済みのものも消さずにここへ残る */
  spot_ids: string[];
  /** `spot_ids` のうち訪問済みのもの。経路(地図の矢印・Google マップ)から外す判定に使う */
  visited_spot_ids: string[];
  created_at: string;
  updated_at: string;
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
  spot_region: string;
  spot_series: Series | null;
  /** バッジの色はランクが決めるので、シリーズと一緒に持つ */
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

/** 訪問日時(ISO 8601)を表示用文字列にする(未入力は「時期不明」) */
export function formatVisitedOn(visitedOn: string | null): string {
  if (!visitedOn) return "時期不明";
  const d = new Date(visitedOn);
  if (Number.isNaN(d.getTime())) return "時期不明";
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
