-- スポット同士を「巡った順」の矢印で繋ぐルート機能の追加分スキーマ。
-- 新規DB(db/data/が空)では01_schema.sqlに続いて自動実行される。
-- 既存DB(db/data/あり)には自動実行されないため、手動で適用する:
--   docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d travel_log < db/init/02_spot_key_routes.sql
-- 全文idempotent(if not exists)にしてあるため、適用済みのDBに再度流しても害はない。

-- spots.key: CSV等の外部データからスポットを参照するための、種別内で一意な省略可のキー。
-- ルートCSV(route,seq,spot_key)がスポットを指すために使う。改名・座標修正で参照が
-- 壊れないよう、name等の自然キーではなくこの明示キーで紐付ける。キーが不要なスポット
-- (ルートに参加しない・手動追加分など)はnullのままでよい
alter table spots add column if not exists key text;
create unique index if not exists spots_spot_type_key_idx
  on spots (spot_type_id, key) where key is not null;

-- =============================================================
-- spot_routes: スポットを巡った順に繋ぐルート(1本の矢印列)。
-- 水曜どうでしょうの企画のように「巡った順番」を持つスポット種別で、
-- 地図上に順路の矢印を描くために使う。nameはルートの表示名で、種別の
-- ランク値(=企画名)と一致させると矢印がそのランクの色で描かれる
-- =============================================================
create table if not exists spot_routes (
  id           uuid primary key default gen_random_uuid(),
  spot_type_id uuid not null references spot_types (id) on delete cascade,
  name         text not null,
  created_at   timestamptz not null default now(),
  unique (spot_type_id, name)
);

-- =============================================================
-- spot_route_points: ルートの経由地(順序付き)。seqの昇順が巡った順で、
-- 隣り合う2点の間に矢印が引かれる。スポット削除時はcascadeで点だけ抜け、
-- ルート自体は残る(矢印は残った点同士を繋ぐ)
-- =============================================================
create table if not exists spot_route_points (
  route_id uuid not null references spot_routes (id) on delete cascade,
  seq      integer not null,
  spot_id  uuid not null references spots (id) on delete cascade,
  primary key (route_id, seq)
);

create index if not exists spot_route_points_spot_id_idx on spot_route_points (spot_id);
