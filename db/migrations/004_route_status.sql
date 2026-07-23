-- 004: spot_routes に status / created_by を追加(spotsと同じ公開状態の仕組み)
--
-- 公開(published)ルートは全員に見え、非公開(private)は作成者本人のみ、
-- 承認待ち(pending)・却下(rejected)は本人+moderator以上が見える。
-- 既存ルートはすべてCSVインポート(spot_admin/admin)由来のため公開扱いにする
-- (statusの既定値'published'がそのまま適用される)。created_byは記録が無いためnullのまま。
-- 全文idempotent。
--
-- 適用はdb-migrateサービスが自動で行う(docker compose up で未適用分だけが走る)。
-- トランザクションと schema_migrations への記録は db/entrypoint.sh 側が受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

alter table spot_routes
  add column if not exists status text not null default 'published';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'spot_routes_status_check'
  ) then
    alter table spot_routes add constraint spot_routes_status_check
      check (status in ('published', 'pending', 'rejected', 'private'));
  end if;
end
$$;

alter table spot_routes
  add column if not exists created_by uuid references users (id) on delete set null;
