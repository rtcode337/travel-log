-- 007: 未訪問記録(spot_notes)と非表示スポット(spot_hides)を追加
--
-- spot_notes: 訪問したが休みや時間の都合でちゃんと見られなかった、事前の下調べを
-- メモしておきたい、といった「訪問記録にはしない個人メモ」。visitsと独立の非公開
-- データで、同一ユーザー×同一スポットで複数件持てる。訪問済みの判定には関与しない。
--
-- spot_hides: 公開スポットのうち「自分は興味がない」ものをユーザーごとに地図・一覧
-- から隠す設定。同一ユーザー×同一スポットは1件まで(トグル管理)。
--
-- 全文idempotent。
--
-- 適用はdb-migrateサービスが自動で行う(docker compose up で未適用分だけが走る)。
-- トランザクションと schema_migrations への記録は db/entrypoint.sh 側が受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

create table if not exists spot_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  spot_id    uuid not null references spots (id) on delete cascade,
  noted_on   timestamptz,
  memo       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists spot_notes_user_id_idx on spot_notes (user_id);
create index if not exists spot_notes_spot_id_idx on spot_notes (spot_id);

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

drop trigger if exists spot_notes_set_updated_at on spot_notes;
create trigger spot_notes_set_updated_at
  before update on spot_notes
  for each row execute function set_updated_at();

drop trigger if exists spot_hides_set_updated_at on spot_hides;
create trigger spot_hides_set_updated_at
  before update on spot_hides
  for each row execute function set_updated_at();
