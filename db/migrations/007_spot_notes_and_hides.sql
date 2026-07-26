-- 007: 未訪問記録(visits.unvisited)と非表示スポット(spot_hides)を追加
--
-- visits.unvisited: trueの行は「未訪問記録」。訪問したが休みや時間の都合で
-- ちゃんと見られなかった(visited_onあり)、または事前の下調べのメモ(visited_onなし)。
-- どちらも訪問済みの判定には数えず、それ以外の扱いは通常の訪問記録と同じ。
--
-- spot_hides: 公開スポットのうち「自分は興味がない」ものをユーザーごとに地図・一覧
-- から隠す設定。同一ユーザー×同一スポットは1件まで(トグル管理)。
--
-- 全文idempotent。
--
-- 適用はdb-migrateサービスが自動で行う(docker compose up で未適用分だけが走る)。
-- トランザクションと schema_migrations への記録は db/entrypoint.sh 側が受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

alter table visits add column if not exists unvisited boolean not null default false;

create table if not exists spot_hides (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  spot_id    uuid not null references spots (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, spot_id)
);

create index if not exists spot_hides_user_id_idx on spot_hides (user_id);
create index if not exists spot_hides_spot_id_idx on spot_hides (spot_id);

drop trigger if exists spot_hides_set_updated_at on spot_hides;
create trigger spot_hides_set_updated_at
  before update on spot_hides
  for each row execute function set_updated_at();
