-- 観光地訪問記録アプリ スキーマ(ローカル Postgres 版)
-- スポットは spot_types で「種別」を持つ。地図・一覧・管理画面は必ず /[type]/... の
-- URLキー経由で対象の種別を指定し(キー無しのURL・APIリクエストは404/400)、
-- app_settings.active_spot_type_id は「ログイン後に自動で開く種別の既定値」としてのみ使う。
-- 'tourist'はアプリ初期化時(このファイル)で必ず作成される既定の種別。
--
-- 【スキーマ変更のルール】
-- 1. DB定義はすべてこの1ファイルにまとめる。テーブル・列・索引・トリガーを
--    追加分の別ファイルに切り出さず、常にこのファイルだけを編集すること
--    (このファイルが「現在あるべきスキーマの唯一の定義」)。
-- 2. テーブルに変更を加える場合は、あわせて db/migrations/ にテーブル修正
--    スクリプトを作り、本番DBを既存データを保持したまま移行可能にすること
--    (本番には利用者の訪問記録・写真が入るため、作り直しはできない)。
--    詳細な手順は CLAUDE.md「コマンド」の項を参照。
--
-- 全テーブルに created_at / updated_at を持たせ、updated_at は set_updated_at()
-- トリガーで自動更新する(下部にまとめてトリガーを定義してある)。
--
-- このファイルは postgres の docker-entrypoint-initdb.d には置かず(dbコンテナに
-- マウントもしない)、db-migrate サービスが '000_init_schema' という名前の
-- 「先頭のマイグレーション」として流す。空のDBには実行され、既にテーブルがある
-- DBには実行されず適用済みとして記録されるだけになる(db/entrypoint.sh 参照)。

create extension if not exists pgcrypto;

-- =============================================================
-- updated_at 自動更新。全テーブルのトリガーから共有する
-- =============================================================
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================
-- spot_types: スポット種別マスタ。管理者が新しい種別を追加できる
-- =============================================================
create table spot_types (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,   -- 機械可読キー(例: 'tourist')
  label           text not null,          -- 表示名(例: '観光地')
  -- 画面に並べる順(小さいほど先)。同じ値なら作成順。管理画面から並び替える
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- =============================================================
-- spot_type_settings: スポット種別ごとの設定をkey/valueで持つ
-- (口コミ・Wikipediaリンク・閲覧を管理者以外不可にするなど)。設定を追加するたびに
-- spot_types に列を増やさずに済むよう、EAV形式にしてある。値はboolean相当を
-- 'true'/'false'の文字列で保存するもの(既知のキー・既定値・表示名は
-- lib/types.ts の SPOT_TYPE_SETTING_DEFAULTS/SPOT_TYPE_SETTING_LABELS 参照)のほか、
-- 文字列値のキーもある: series_styles(シリーズ定義のJSON、lib/seriesStyle.ts)、
-- categories(カテゴリ一覧のJSON、lib/category.ts)、region_scope(対象地域
-- 'jp'/国コード/'world')・wikipedia_lang(言語コード。いずれも lib/region.ts 参照)。
-- 行が存在しないキーは設定ごとの既定値として扱う(設定により既定値は異なる)。
-- かつて存在した spot_types.visibility 列(public/admin_only/disabled の3値)は廃止し、
-- admin_only設定(true/false)に一本化した。disabled相当(誰にも見せない)は、
-- スポット種別そのものの削除(/[type]/admin の「スポット種別の管理」)で代替する
-- =============================================================
create table spot_type_settings (
  spot_type_id uuid not null references spot_types (id) on delete cascade,
  key          text not null,
  value        text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (spot_type_id, key)
);

-- =============================================================
-- app_settings: アプリ全体の設定。ログイン後に自動で開くスポット種別(既定値)を
-- 1行だけ保持する。地図・一覧・APIの対象種別はURLキーで決まるため、ここでの値は
-- ルート("/")のリダイレクト先を決めるためだけに使う。
-- singleton列のPKトリックで常に1行に制約する(切替は常にUPDATE)
-- =============================================================
create table app_settings (
  singleton           boolean primary key default true check (singleton),
  active_spot_type_id uuid not null references spot_types (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- =============================================================
-- users: ログイン用アカウント
-- role: admin(承認・削除・ユーザー管理・スポット種別設定) /
--       spot_admin(ユーザー管理・種別設定を除き、スポットについてはadminと同じ権限) /
--       moderator(スポットをpendingで追加、承認待ちは全件閲覧のみ) / user(一般)
-- 新規アカウントは管理者が /admin から作成する(自由サインアップなし)。
-- 最初の1アカウントのみ例外的にセットアップ画面(/login)から作成でき、自動的にadminになる。
-- =============================================================
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text,
  google_id     text unique,
  role          text not null default 'user' check (role in ('admin', 'spot_admin', 'moderator', 'user')),
  nickname      text, -- 口コミ等に表示する表示名(未設定なら「匿名」と表示。メールアドレスは出さない)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint users_has_login_method check (password_hash is not null or google_id is not null)
);

-- =============================================================
-- spots: スポットマスタ(種別はspot_type_idで区別)
-- 見た目と分類の軸は3つ。rank(A〜E。アプリに決め打ちで、ピンの色と大きさを決める。
-- 種別ごとにrank_enabledで使うかを選ぶ)、series(1スポットに0か1つ。ピンの中身と形、
-- ランクを使わない種別では色も決める)、categories(0個以上。絞り込み専用)。
-- series/categoriesの値は種別ごとに意味が異なりうるため自由入力
-- =============================================================
create table spots (
  id            uuid primary key default gen_random_uuid(),
  spot_type_id  uuid not null references spot_types (id),
  -- CSV等の外部データからこのスポットを参照するための、種別内で一意な省略可のキー。
  -- ルートCSV(route,seq,spot_key)がスポットを指すために使う。改名・座標修正で参照が
  -- 壊れないよう、name等の自然キーではなくこの明示キーで紐付ける。キーが不要なスポット
  -- (ルートに参加しない・手動追加分など)はnullのままでよい
  key           text,
  name          text not null,
  name_kana     text,
  lat           double precision not null,
  lng           double precision not null,
  -- 地域。種別のregion_scope設定により意味が変わる(既定'jp'=都道府県、
  -- 国コード指定=その国の州・県、'world'=国名)。座標から決まる従属値のため
  -- lat/lngの後ろに置いている
  region        text not null,
  -- 重要度・知名度の段階。値はA〜E固定(lib/rank.ts)で、nullは「なし」。
  -- 種別がrank_enabledのときだけ意味を持つ(使わない種別では常にnull扱い)
  rank          text check (rank in ('A', 'B', 'C', 'D', 'E')),
  series        text,
  categories    text[] not null default '{}',
  description   text,
  -- private: 誰でも作成できる非公開スポット。作成者本人にしか見えず、口コミも使えない
  status        text not null default 'published' check (
    status in ('published', 'pending', 'rejected', 'private')
  ),
  -- 登録経路。csv=管理画面のCSVインポート(travel-log-data由来)、manual=それ以外
  -- (地図の右クリック追加・管理画面の追加フォーム)。手動追加された公開スポットを
  -- travel-log-dataへ還元するためのエクスポート(/[type]/admin)の抽出条件に使う。
  -- 還元してCSVを再インポートすると、一致した行はcsvに更新される(還元済みの印)
  origin        text not null default 'manual' check (origin in ('csv', 'manual')),
  created_by    uuid references users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index spots_region_idx on spots (region);
create index spots_series_idx on spots (series);
create index spots_rank_idx on spots (rank);
create index spots_spot_type_id_idx on spots (spot_type_id);
-- 複数カテゴリの絞り込み(categories && $1)を配列の包含演算子で引くためのGIN索引
create index spots_categories_idx on spots using gin (categories);
create unique index spots_spot_type_key_idx
  on spots (spot_type_id, key) where key is not null;
-- 公開スポットのダウンロード(GET /api/spots の limit/offset 分割取得)用。
-- 並びと同じ順の索引が無いと、チャンクごとに該当行を全部ソートし直すことになる
-- (5万件規模の種別では26回のソートになる)。並びに id を含めるのは全順序に
-- するため —— region・name だけでは同値の行の順が実行ごとに変わりうる
create index spots_download_order_idx on spots (spot_type_id, region, name, id);

-- =============================================================
-- spot_deletions: 画面から個別削除された公開スポットの記録(削除の墓標)。
-- CSV由来(origin='csv')の公開スポットをDELETE /api/spots/[id]で消したときだけ
-- 記録し、travel-log-data側のexclude.txtへ追記する候補として還元用エクスポート
-- (/[type]/admin)に出す。purge・キー一覧を指定しての削除・種別削除は
-- travel-log-data側発の操作のため記録しない。行そのものは消えるため、
-- 突き合わせに使うkey・name等の値をコピーして残す(created_atが削除日時)
-- =============================================================
create table spot_deletions (
  id           uuid primary key default gen_random_uuid(),
  spot_type_id uuid not null references spot_types (id) on delete cascade,
  key          text,
  name         text not null,
  lat          double precision not null,
  lng          double precision not null,
  region       text not null,
  deleted_by   uuid references users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index spot_deletions_spot_type_id_idx on spot_deletions (spot_type_id);

-- =============================================================
-- spot_routes: スポットを巡った順に繋ぐルート(1本の矢印列)。
-- 「巡った順番」に意味があるスポット種別で、地図上に順路の矢印を描くために使う。
-- nameはルートの表示名。seriesはこのルートが属するシリーズ(spots.seriesと
-- 同じ値空間)で、指定するとその色で矢印が描かれ、シリーズ絞り込みにも連動する。
-- 表示名とシリーズは別物のため列を分けてある(同じシリーズに複数のルートを
-- 持たせられる)。未指定(null)のルートは既定色で描かれる。
-- descriptionはルートの説明文(地図でルートの線をタップすると出る詳細に表示)。
-- status・created_byはspotsと同じ公開状態の仕組み(公開ルートは全員に見え、
-- 非公開は作成者本人のみ、承認待ち・却下は本人+moderator以上)
-- =============================================================
create table spot_routes (
  id           uuid primary key default gen_random_uuid(),
  spot_type_id uuid not null references spot_types (id) on delete cascade,
  name         text not null,
  series       text,
  description  text,
  status       text not null default 'published' check (
    status in ('published', 'pending', 'rejected', 'private')
  ),
  created_by   uuid references users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (spot_type_id, name)
);

create index spot_routes_series_idx on spot_routes (series);

-- =============================================================
-- spot_route_points: ルートの経由地(順序付き)。seqの昇順が巡った順で、
-- 隣り合う2点の間に矢印が引かれる。スポット削除時はcascadeで点だけ抜け、
-- ルート自体は残る(矢印は残った点同士を繋ぐ)。
-- descriptionはこの経由地から次の経由地への区間の説明(移動手段など。
-- ルート詳細の経由地一覧で2点の間に表示する)。最終地点には次の区間が
-- 無いため常にnull。ルート全体の説明はspot_routes.description
-- =============================================================
create table spot_route_points (
  route_id    uuid not null references spot_routes (id) on delete cascade,
  seq         integer not null,
  spot_id     uuid not null references spots (id) on delete cascade,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (route_id, seq)
);

create index spot_route_points_spot_id_idx on spot_route_points (spot_id);

-- =============================================================
-- visits: 訪問記録(同一スポットへの複数回訪問を許容)。
-- visited_onは訪問した日時(timestamptz)。覚えていない場合はnullでよく、
-- 表示は「時期不明」になる。
-- unvisited=trueの行は「未訪問記録」: 訪問したが休みや時間の都合でちゃんと
-- 見られなかった(visited_onあり=その日の訪問順の経路には含まれ、訪問予定も外れる)、
-- または事前の下調べのメモ(visited_onなし=訪問予定は外れない)。どちらも
-- 訪問済みの判定(ピンの緑色・訪問状況の絞り込み)には数えず、それ以外の扱い
-- (写真・メモ・編集・一覧)は通常の訪問記録と同じ
-- =============================================================
create table visits (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users (id) on delete cascade,
  spot_id        uuid not null references spots (id) on delete cascade,
  visited_on     timestamptz,
  memo           text,
  -- photosフォルダ(docker-composeでbindマウント)内の相対パス
  -- 「<ユーザーID>/<年>/<月>/<uuid>.<拡張子>」を保存する(lib/photos.ts参照)
  photos         text[] not null default '{}',
  unvisited      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index visits_user_id_idx on visits (user_id);
create index visits_spot_id_idx on visits (spot_id);

-- =============================================================
-- visit_notes: 訪問記録への「追記」。行った日に書ききれなかったこと・後から
-- 分かったことを、**訪問回数を増やさずに**同じ訪問記録へぶら下げる。
-- 1つの訪問記録に何件でも付けられ、画面では「<作成日時>に追記」として
-- 元の記録の下(写真も元の写真の後ろ)に古い順で並ぶ。
-- 所有者は visits 側の user_id で決まる(この表には持たない。訪問記録が
-- 消えれば追記も cascade で消える)。photos は visits と同じ相対パス
-- 「<ユーザーID>/<年>/<月>/<uuid>.<拡張子>」(lib/photos.ts参照)
-- =============================================================
create table visit_notes (
  id         uuid primary key default gen_random_uuid(),
  visit_id   uuid not null references visits (id) on delete cascade,
  body       text,
  photos     text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index visit_notes_visit_id_idx on visit_notes (visit_id);

-- =============================================================
-- spot_hides: 非表示スポット。公開スポットのうち「自分は興味がない」ものを
-- ユーザーごとに地図・一覧から隠すための設定(スポット自体には一切影響しない)。
-- 同一ユーザー×同一スポットは1件まで(トグル管理。visit_plansと同じ構造)
-- =============================================================
create table spot_hides (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  spot_id    uuid not null references spots (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, spot_id)
);

create index spot_hides_user_id_idx on spot_hides (user_id);
create index spot_hides_spot_id_idx on spot_hides (spot_id);

-- =============================================================
-- visit_plans: 訪問予定リスト(行きたい場所のブックマーク)。
-- 同一ユーザー×同一スポットは1件まで(トグル管理)。訪問を記録すると自動で消える
-- (app/api/visits/route.tsのPOST参照)
-- =============================================================
create table visit_plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  spot_id    uuid not null references spots (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, spot_id)
);

create index visit_plans_user_id_idx on visit_plans (user_id);
create index visit_plans_spot_id_idx on visit_plans (spot_id);

-- 訪問予定リスト(旅程)。複数スポットを順序付きでまとめる。種別ごとに紐づき、
-- 1スポットごとの visit_plans とは独立(詳細は migrations/006)。
create table visit_plan_lists (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  spot_type_id  uuid not null references spot_types (id) on delete cascade,
  title         text not null,
  description   text,
  start_date    date not null,
  end_date      date not null,
  -- アーカイブした日時(nullなら通常のリスト)。回り終わった旅程を一覧から
  -- 下げるための印で、消すのとは違い中身はそのまま残る。アーカイブ済みは
  -- 通常の一覧・地図の経路・「リストに追加」の対象から外れ、
  -- アーカイブの一覧(スポット画面の訪問予定リストから開く)にだけ出る
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index visit_plan_lists_user_id_idx on visit_plan_lists (user_id);
create index visit_plan_lists_spot_type_id_idx on visit_plan_lists (spot_type_id);

-- visited_at: 訪問済みになった日時(nullなら未訪問)。訪問記録を付けると自動で入り、
-- 画面から手で付け外しもできる。訪問済みの経由スポットは経路(地図の紫の矢印・
-- Google マップの経路検索)から外れるが、行はリストに残す
-- ——「その旅程で何を回ったか」を後から辿れるようにするため
create table visit_plan_list_items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references visit_plan_lists (id) on delete cascade,
  spot_id     uuid not null references spots (id) on delete cascade,
  seq         int not null,
  visited_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (list_id, spot_id)
);

create index visit_plan_list_items_list_id_idx on visit_plan_list_items (list_id);
create index visit_plan_list_items_spot_id_idx on visit_plan_list_items (spot_id);

-- =============================================================
-- export_jobs: 訪問記録+写真のZIPエクスポート。管理者が対象ユーザーを指定して
-- 実行し、生成はバックグラウンドで進む(running → done / failed)。
-- ZIP本体は /app/exports(ホストの ./exports をbindマウント)に置き、ここには
-- そこからの相対パスだけを持つ(写真と同じ持ち方)。
-- 同じユーザーのZIPは最新1件だけ残す(新しいものが done になった時点で前を削除)
-- =============================================================
create table export_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  requested_by uuid references users (id) on delete set null,
  status       text not null default 'running'
                 check (status in ('running', 'done', 'failed')),
  file_path    text,
  file_size    bigint,
  visit_count  int,
  photo_count  int,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index export_jobs_user_id_idx on export_jobs (user_id);

-- =============================================================
-- reviews: 口コミ。投稿するたびに増える掲示板方式(1ユーザーが同じスポットに何件でも書ける)。
-- スポット種別ごとにspot_type_settingsの'reviews_enabled'で機能そのもののON/OFFを切り替えられる。
-- シリーズ表示ロジックには reviews を一切参照させないこと
-- =============================================================
create table reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  spot_id    uuid not null references spots (id) on delete cascade,
  body       text not null,
  visibility text not null default 'private' check (visibility in ('public', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reviews_spot_id_idx on reviews (spot_id);

-- =============================================================
-- updated_at 自動更新トリガー(全テーブル分)
-- =============================================================
create trigger spot_types_set_updated_at
  before update on spot_types
  for each row execute function set_updated_at();

create trigger spot_type_settings_set_updated_at
  before update on spot_type_settings
  for each row execute function set_updated_at();

create trigger app_settings_set_updated_at
  before update on app_settings
  for each row execute function set_updated_at();

create trigger users_set_updated_at
  before update on users
  for each row execute function set_updated_at();

create trigger spots_set_updated_at
  before update on spots
  for each row execute function set_updated_at();

create trigger spot_deletions_set_updated_at
  before update on spot_deletions
  for each row execute function set_updated_at();

create trigger spot_routes_set_updated_at
  before update on spot_routes
  for each row execute function set_updated_at();

create trigger spot_route_points_set_updated_at
  before update on spot_route_points
  for each row execute function set_updated_at();

create trigger visits_set_updated_at
  before update on visits
  for each row execute function set_updated_at();

create trigger spot_hides_set_updated_at
  before update on spot_hides
  for each row execute function set_updated_at();

create trigger visit_plans_set_updated_at
  before update on visit_plans
  for each row execute function set_updated_at();

create trigger visit_notes_set_updated_at
  before update on visit_notes
  for each row execute function set_updated_at();

create trigger visit_plan_lists_set_updated_at
  before update on visit_plan_lists
  for each row execute function set_updated_at();

create trigger visit_plan_list_items_set_updated_at
  before update on visit_plan_list_items
  for each row execute function set_updated_at();

create trigger reviews_set_updated_at
  before update on reviews
  for each row execute function set_updated_at();

create trigger export_jobs_set_updated_at
  before update on export_jobs
  for each row execute function set_updated_at();

-- =============================================================
-- 参考データ: 既定のスポット種別(観光地)のみ作成する。他の種別は管理画面から
-- 手入力フォーム、または設定情報(公開範囲・シリーズの一覧と見た目等)込みのJSONファイル
-- アップロードで追加する(components/AdminView.tsxの「スポット種別の管理」参照)
-- =============================================================
insert into spot_types (key, label) values ('tourist', '観光地');

-- 既定値から外れるものだけを明示的に登録する(EAV形式なので、既定のままでよい
-- 設定は行自体を作らない)。public_visibleは既定false(=管理者以外閲覧不可)のため、
-- 最初から一般公開しておきたいこの種別には明示的にtrueを入れる。あとから
-- 管理画面で追加する種別は、準備が整うまで自動的に非公開のままになる
insert into spot_type_settings (spot_type_id, key, value)
  select id, 'public_visible', 'true' from spot_types where key = 'tourist';

insert into app_settings (active_spot_type_id)
  select id from spot_types where key = 'tourist';
