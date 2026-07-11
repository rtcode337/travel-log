-- 観光地訪問記録アプリ 初期スキーマ(ローカル Postgres 版)
-- spots(観光地マスタ)/ visits(訪問記録)/ reviews(口コミ・フェーズ3用)を厳密に分離する

create extension if not exists pgcrypto;

-- =============================================================
-- users: ログイン用アカウント
-- role: admin(承認・削除・ユーザー管理) / moderator(スポットをpendingで追加) / user(一般)
-- 新規アカウントは管理者が /admin から作成する(自由サインアップなし)。
-- 最初の1アカウントのみ例外的にセットアップ画面(/login)から作成でき、自動的にadminになる。
-- =============================================================
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text,
  google_id     text unique,
  role          text not null default 'user' check (role in ('admin', 'moderator', 'user')),
  created_at    timestamptz not null default now(),
  constraint users_has_login_method check (password_hash is not null or google_id is not null)
);

-- =============================================================
-- spots: 観光地マスタ
-- 必訪ランク(S/A/B/C/D)はキュレーション項目。口コミ評価とは別軸で管理する
-- Wikipedia(ja)月次ページビュー数を知名度指標としたパーセンタイル区分(lib/types.tsのコメント参照)
-- =============================================================
create table spots (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  name_kana    text,
  prefecture   text not null,
  municipality text,
  lat          double precision not null,
  lng          double precision not null,
  rank         text not null check (rank in ('S', 'A', 'B', 'C', 'D')),
  category     text not null check (
    category in ('神社仏閣', '自然', '城', '温泉', '街並み', '美術館博物館', 'その他')
  ),
  description  text,
  official_url text,
  source       text not null default 'manual' check (
    source in ('manual', 'opendata', 'user_submitted')
  ),
  status       text not null default 'published' check (
    status in ('published', 'pending', 'rejected')
  ),
  created_by   uuid references users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index spots_prefecture_idx on spots (prefecture);
create index spots_rank_idx on spots (rank);

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
-- reviews: 口コミ。ユーザー1人につき1スポット1件(upsert対象)
-- ランク表示ロジックには reviews を一切参照させないこと
-- =============================================================
create table reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  spot_id    uuid not null references spots (id) on delete cascade,
  body       text not null,
  visibility text not null default 'private' check (visibility in ('public', 'private')),
  created_at timestamptz not null default now(),
  unique (user_id, spot_id)
);

create index reviews_spot_id_idx on reviews (spot_id);
