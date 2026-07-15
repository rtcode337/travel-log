-- 観光地訪問記録アプリ 初期スキーマ(ローカル Postgres 版)
-- スポットは spot_types で「種類」を持つ。地図・一覧・管理画面は必ず /[type]/... の
-- URLキー経由で対象の種類を指定し(キー無しのURL・APIリクエストは404/400)、
-- app_settings.active_spot_type_id は「ログイン後に自動で開く種類の既定値」としてのみ使う。
-- 'tourist'はアプリ初期化時(このファイル)で必ず作成される既定の種類。

create extension if not exists pgcrypto;

-- =============================================================
-- spot_types: スポットの種類マスタ。管理者が新しい種類を追加できる
-- =============================================================
create table spot_types (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,   -- 機械可読キー(例: 'tourist', 'post_office', 'goshuin')
  label           text not null,          -- 表示名(例: '観光地', '郵便局', '御朱印')
  reviews_enabled boolean not null default true, -- この種類のスポットで口コミ機能を使うか
  created_at      timestamptz not null default now()
);

-- =============================================================
-- app_settings: アプリ全体の設定。ログイン後に自動で開くスポット種類(既定値)を
-- 1行だけ保持する。地図・一覧・APIの対象種類はURLキーで決まるため、ここでの値は
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
-- role: admin(承認・削除・ユーザー管理・スポットの種類設定) /
--       spot_admin(ユーザー管理・種類設定を除き、スポットについてはadminと同じ権限) /
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
  nickname      text, -- 口コミ等に表示する表示名(未設定ならメールアドレスを使う)
  created_at    timestamptz not null default now(),
  constraint users_has_login_method check (password_hash is not null or google_id is not null)
);

-- =============================================================
-- spots: スポットマスタ(種類はspot_type_idで区別)
-- rank/categoryは種類ごとに意味が異なりうるため自由入力(観光地では
-- 必訪ランクS〜D・カテゴリ7種を使うが、他の種類では未使用でもよい)
-- =============================================================
create table spots (
  id            uuid primary key default gen_random_uuid(),
  spot_type_id  uuid not null references spot_types (id),
  name          text not null,
  name_kana     text,
  prefecture    text not null,
  municipality  text,
  lat           double precision not null,
  lng           double precision not null,
  rank          text,
  category      text,
  description   text,
  official_url  text,
  source        text not null default 'manual' check (
    source in ('manual', 'opendata', 'user_submitted')
  ),
  -- private: 誰でも作成できる非公開スポット。作成者本人にしか見えず、口コミも使えない
  status        text not null default 'published' check (
    status in ('published', 'pending', 'rejected', 'private')
  ),
  created_by    uuid references users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index spots_prefecture_idx on spots (prefecture);
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
-- スポットの種類ごとにspot_types.reviews_enabledで機能そのもののON/OFFを切り替えられる。
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
-- 参考データ: スポットの種類3つ(観光地のみデータあり。郵便局・御朱印は今後用の空の種類)
-- =============================================================
insert into spot_types (key, label, reviews_enabled) values
  ('tourist', '観光地', true),
  ('post_office', '郵便局', false),
  ('goshuin', '御朱印', true);

insert into app_settings (active_spot_type_id)
  select id from spot_types where key = 'tourist';
