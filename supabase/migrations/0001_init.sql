-- 観光地訪問記録アプリ 初期スキーマ
-- spots(観光地マスタ)/ visits(訪問記録)/ reviews(口コミ・フェーズ3用)を厳密に分離する

-- =============================================================
-- spots: 観光地マスタ
-- 必訪ランク(S/A/B)はキュレーション項目。口コミ評価とは別軸で管理する
-- =============================================================
create table public.spots (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  name_kana    text,
  prefecture   text not null,
  municipality text,
  lat          double precision not null,
  lng          double precision not null,
  rank         text not null check (rank in ('S', 'A', 'B')),
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
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index spots_prefecture_idx on public.spots (prefecture);
create index spots_rank_idx on public.spots (rank);

-- updated_at 自動更新
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger spots_set_updated_at
  before update on public.spots
  for each row execute function public.set_updated_at();

-- =============================================================
-- visits: 訪問記録(同一スポットへの複数回訪問を許容)
-- =============================================================
create table public.visits (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  spot_id        uuid not null references public.spots (id) on delete cascade,
  visited_on     date,
  date_precision text not null default 'day' check (
    date_precision in ('day', 'month', 'year', 'unknown')
  ),
  memo           text,
  photos         text[] not null default '{}',
  created_at     timestamptz not null default now()
);

create index visits_user_id_idx on public.visits (user_id);
create index visits_spot_id_idx on public.visits (spot_id);

-- =============================================================
-- reviews: 口コミ(フェーズ3で実装。スキーマだけ先行定義)
-- ランク表示ロジックには reviews を一切参照させないこと
-- =============================================================
create table public.reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  spot_id    uuid not null references public.spots (id) on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  body       text,
  visibility text not null default 'private' check (visibility in ('public', 'private')),
  created_at timestamptz not null default now()
);

create index reviews_spot_id_idx on public.reviews (spot_id);

-- =============================================================
-- RLS
-- =============================================================
alter table public.spots enable row level security;
alter table public.visits enable row level security;
alter table public.reviews enable row level security;

-- spots: 全ユーザー読み取り可。
-- 書き込みはフェーズ1では認証済みユーザーなら可(自分しかいない前提)。
-- フェーズ3でユーザー投稿を開放する際は管理者ロール判定に差し替えること。
create policy "spots are readable by everyone"
  on public.spots for select
  using (true);

create policy "authenticated users can insert spots"
  on public.spots for insert
  to authenticated
  with check (true);

create policy "authenticated users can update spots"
  on public.spots for update
  to authenticated
  using (true);

create policy "authenticated users can delete spots"
  on public.spots for delete
  to authenticated
  using (true);

-- visits: 本人のみ読み書き可
create policy "users can read own visits"
  on public.visits for select
  using (auth.uid() = user_id);

create policy "users can insert own visits"
  on public.visits for insert
  with check (auth.uid() = user_id);

create policy "users can update own visits"
  on public.visits for update
  using (auth.uid() = user_id);

create policy "users can delete own visits"
  on public.visits for delete
  using (auth.uid() = user_id);

-- reviews: public は全員読み取り可、書き込みは本人のみ
create policy "public reviews are readable by everyone"
  on public.reviews for select
  using (visibility = 'public' or auth.uid() = user_id);

create policy "users can insert own reviews"
  on public.reviews for insert
  with check (auth.uid() = user_id);

create policy "users can update own reviews"
  on public.reviews for update
  using (auth.uid() = user_id);

create policy "users can delete own reviews"
  on public.reviews for delete
  using (auth.uid() = user_id);
