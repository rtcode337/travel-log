-- spot_typesの有効/無効フラグ(enabled boolean)を3値の公開範囲
-- visibility('public' | 'admin_only' | 'disabled')に置き換えるマイグレーション。
-- 新規DBでは01_schema.sqlが最初からvisibility列を作るため、このファイルは何もしない。
-- 既存の db/data/ があるDBへは手動で適用する(CLAUDE.md参照):
--   docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d travel_log < db/init/05_spot_type_visibility.sql
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'spot_types' and column_name = 'enabled'
  ) then
    alter table public.spot_types
      add column visibility text not null default 'public'
      check (visibility in ('public', 'admin_only', 'disabled'));
    update public.spot_types set visibility = 'disabled' where not enabled;
    alter table public.spot_types drop column enabled;
  end if;
end
$$;
