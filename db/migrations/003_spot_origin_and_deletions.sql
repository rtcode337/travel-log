-- 003: spots.origin(登録経路)と spot_deletions(削除の墓標)を追加
--
-- originはcsv(CSVインポート=travel-log-data由来)/manual(地図の右クリック追加・
-- 管理画面の追加フォーム)の2値で、手動追加された公開スポットをtravel-log-dataへ
-- 還元するためのエクスポートの抽出条件に使う。spot_deletionsは画面から個別削除された
-- CSV由来の公開スポットの記録で、exclude.txtへの追記候補として同エクスポートに出す。
-- 全文idempotent。
--
-- 適用はdb-migrateサービスが自動で行う(docker compose up で未適用分だけが走る)。
-- トランザクションと schema_migrations への記録は db/entrypoint.sh 側が受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

-- -------------------------------------------------------------
-- 1. spots.origin。既存行の由来は記録が無いため、key有無で一度だけ近似する
--    (これまでkeyを設定する経路はCSVインポートしか無かったため、
--    key有り=CSV由来。key無しにはCSVのkey付与前の初回投入分も含まれるが、
--    その分は還元用エクスポートに混ざったら目視で除く運用とする)
-- -------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'spots' and column_name = 'origin'
  ) then
    alter table spots add column origin text;
    update spots set origin = case when key is not null then 'csv' else 'manual' end;
    alter table spots alter column origin set not null;
    alter table spots alter column origin set default 'manual';
    alter table spots add constraint spots_origin_check
      check (origin in ('csv', 'manual'));
  end if;
end
$$;

-- -------------------------------------------------------------
-- 2. spot_deletions(削除の墓標)
-- -------------------------------------------------------------
create table if not exists spot_deletions (
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

create index if not exists spot_deletions_spot_type_id_idx
  on spot_deletions (spot_type_id);

drop trigger if exists spot_deletions_set_updated_at on spot_deletions;
create trigger spot_deletions_set_updated_at
  before update on spot_deletions
  for each row execute function set_updated_at();
