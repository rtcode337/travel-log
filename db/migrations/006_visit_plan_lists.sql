-- 006: 訪問予定リスト(旅程)を追加
--
-- 複数のスポットを1つの「訪問予定リスト」(旅行の旅程)としてまとめる機能。
-- タイトル・説明・訪問予定期間(開始日〜終了日)を持ち、スポットを順序付きで持つ。
-- 種別ごと(spot_type_id)に紐づき、既存の1スポットごとの visit_plans とは独立。
-- 全文idempotent。
--
-- 適用はdb-migrateサービスが自動で行う(docker compose up で未適用分だけが走る)。
-- トランザクションと schema_migrations への記録は db/entrypoint.sh 側が受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

create table if not exists visit_plan_lists (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  spot_type_id  uuid not null references spot_types (id) on delete cascade,
  title         text not null,
  description   text,
  start_date    date not null,
  end_date      date not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists visit_plan_lists_user_id_idx on visit_plan_lists (user_id);
create index if not exists visit_plan_lists_spot_type_id_idx on visit_plan_lists (spot_type_id);

create table if not exists visit_plan_list_items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references visit_plan_lists (id) on delete cascade,
  spot_id     uuid not null references spots (id) on delete cascade,
  seq         int not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (list_id, spot_id)
);

create index if not exists visit_plan_list_items_list_id_idx on visit_plan_list_items (list_id);
create index if not exists visit_plan_list_items_spot_id_idx on visit_plan_list_items (spot_id);

drop trigger if exists visit_plan_lists_set_updated_at on visit_plan_lists;
create trigger visit_plan_lists_set_updated_at
  before update on visit_plan_lists
  for each row execute function set_updated_at();

drop trigger if exists visit_plan_list_items_set_updated_at on visit_plan_list_items;
create trigger visit_plan_list_items_set_updated_at
  before update on visit_plan_list_items
  for each row execute function set_updated_at();
