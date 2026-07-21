-- 観光地訪問記録アプリ 初期スキーマ(ローカル Postgres 版)
-- スポットは spot_types で「種別」を持つ。地図・一覧・管理画面は必ず /[type]/... の
-- URLキー経由で対象の種別を指定し(キー無しのURL・APIリクエストは404/400)、
-- app_settings.active_spot_type_id は「ログイン後に自動で開く種別の既定値」としてのみ使う。
-- 'tourist'はアプリ初期化時(このファイル)で必ず作成される既定の種別。

create extension if not exists pgcrypto;

-- =============================================================
-- spot_types: スポット種別マスタ。管理者が新しい種別を追加できる
-- =============================================================
create table spot_types (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,   -- 機械可読キー(例: 'tourist')
  label           text not null,          -- 表示名(例: '観光地')
  created_at      timestamptz not null default now()
);

-- =============================================================
-- spot_type_settings: スポット種別ごとの設定をkey/valueで持つ
-- (口コミ・Wikipediaリンク・閲覧を管理者以外不可にするなど)。設定を追加するたびに
-- spot_types に列を増やさずに済むよう、EAV形式にしてある。値はboolean相当を
-- 'true'/'false'の文字列で保存するもの(既知のキー・既定値・表示名は
-- lib/types.ts の SPOT_TYPE_SETTING_DEFAULTS/SPOT_TYPE_SETTING_LABELS 参照)のほか、
-- 文字列値のキーもある: rank_styles(ランク定義のJSON、lib/rankStyle.ts)、
-- region_scope(対象地域 'jp'/国コード/'world')・wikipedia_lang(言語コード。
-- いずれも lib/region.ts 参照)。
-- 行が存在しないキーは設定ごとの既定値として扱う(設定により既定値は異なる)。
-- かつて存在した spot_types.visibility 列(public/admin_only/disabled の3値)は廃止し、
-- admin_only設定(true/false)に一本化した。disabled相当(誰にも見せない)は、
-- スポット種別そのものの削除(/[type]/admin の「スポット種別の管理」)で代替する
-- =============================================================
create table spot_type_settings (
  spot_type_id uuid not null references spot_types (id) on delete cascade,
  key          text not null,
  value        text not null,
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
  constraint users_has_login_method check (password_hash is not null or google_id is not null)
);

-- =============================================================
-- spots: スポットマスタ(種別はspot_type_idで区別)
-- rank/categoryは種別ごとに意味が異なりうるため自由入力(観光地では
-- 必訪ランクA〜E・カテゴリ7種を使うが、他の種別では未使用でもよい)
-- =============================================================
create table spots (
  id            uuid primary key default gen_random_uuid(),
  spot_type_id  uuid not null references spot_types (id),
  name          text not null,
  name_kana     text,
  -- 地域。種別のregion_scope設定により意味が変わる(既定'jp'=都道府県、
  -- 国コード指定=その国の州・県、'world'=国名)
  region        text not null,
  lat           double precision not null,
  lng           double precision not null,
  rank          text,
  category      text,
  description   text,
  -- private: 誰でも作成できる非公開スポット。作成者本人にしか見えず、口コミも使えない
  status        text not null default 'published' check (
    status in ('published', 'pending', 'rejected', 'private')
  ),
  created_by    uuid references users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index spots_region_idx on spots (region);
create index spots_rank_idx on spots (rank);
create index spots_spot_type_id_idx on spots (spot_type_id);

-- updated_at 自動更新
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger spots_set_updated_at
  before update on spots
  for each row execute function set_updated_at();

-- =============================================================
-- visits: 訪問記録(同一スポットへの複数回訪問を許容)
-- =============================================================
create table visits (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users (id) on delete cascade,
  spot_id        uuid not null references spots (id) on delete cascade,
  visited_on     date,
  date_precision text not null default 'day' check (
    date_precision in ('day', 'month', 'year', 'unknown')
  ),
  memo           text,
  -- photosフォルダ(docker-composeでbindマウント)内の相対パス
  -- 「<ユーザーID>/<年>/<月>/<uuid>.<拡張子>」を保存する(lib/photos.ts参照)
  photos         text[] not null default '{}',
  created_at     timestamptz not null default now()
);

create index visits_user_id_idx on visits (user_id);
create index visits_spot_id_idx on visits (spot_id);

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
  unique (user_id, spot_id)
);

create index visit_plans_user_id_idx on visit_plans (user_id);
create index visit_plans_spot_id_idx on visit_plans (spot_id);

-- =============================================================
-- reviews: 口コミ。投稿するたびに増える掲示板方式(1ユーザーが同じスポットに何件でも書ける)。
-- スポット種別ごとにspot_type_settingsの'reviews_enabled'で機能そのもののON/OFFを切り替えられる。
-- ランク表示ロジックには reviews を一切参照させないこと
-- =============================================================
create table reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  spot_id    uuid not null references spots (id) on delete cascade,
  body       text not null,
  visibility text not null default 'private' check (visibility in ('public', 'private')),
  created_at timestamptz not null default now()
);

create index reviews_spot_id_idx on reviews (spot_id);

-- =============================================================
-- 参考データ: 既定のスポット種別(観光地)のみ作成する。他の種別は管理画面から
-- 手入力フォーム、または設定情報(公開範囲・ランクの一覧と見た目等)込みのJSONファイル
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
