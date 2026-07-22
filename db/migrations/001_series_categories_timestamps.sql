-- 001: シリーズへの改名 / 複数カテゴリ / 全テーブルのcreated_at・updated_at /
--      date_precision廃止 / visited_onのtimestamptz化 / spot_routes.series 追加
--
-- 旧スキーマ(rank・category単数・date_precisionあり)のDBを現在の
-- db/init/01_schema.sql と同じ形に移行する。全文idempotent。
--
-- 適用はdb-initサービスが自動で行う(docker compose up で未適用分だけが走る)。
-- トランザクションと schema_migrations への記録は db/entrypoint.sh 側が受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。
--
-- 注: 列の並び順(01_schema.sqlではlat/lngの後ろにregion)はPostgresでは
-- 既存テーブルに対して変更できないため、このスクリプトでは揃えない。
-- 並び順はアプリの動作に影響しない(常に列名で読み書きしている)。

-- -------------------------------------------------------------
-- 1. spots.rank -> spots.series
-- -------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'spots' and column_name = 'rank'
  ) then
    alter table spots rename column rank to series;
  end if;
end
$$;

alter index if exists spots_rank_idx rename to spots_series_idx;

-- -------------------------------------------------------------
-- 2. spots.category(単数 text) -> spots.categories(複数 text[])
-- -------------------------------------------------------------
alter table spots add column if not exists categories text[] not null default '{}';

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'spots' and column_name = 'category'
  ) then
    update spots
       set categories = array[category]
     where category is not null and category <> '' and categories = '{}';
    alter table spots drop column category;
  end if;
end
$$;

create index if not exists spots_categories_idx on spots using gin (categories);

-- -------------------------------------------------------------
-- 3. spot_type_settings の 'rank_styles' -> 'series_styles'
--    (JSON内の各要素の "rank" キーも "series" に置換)
--    同じテーブルにJSONでない値の行(region_scope等)も同居するため、
--    1行ずつ回してparse不能なものはキー名だけ移す
-- -------------------------------------------------------------
do $$
declare
  r record;
  converted text;
begin
  for r in select spot_type_id, value from spot_type_settings where key = 'rank_styles' loop
    begin
      select jsonb_agg(elem - 'rank' || jsonb_build_object('series', elem ->> 'rank')
                       order by ord)::text
        into converted
        from jsonb_array_elements(r.value::jsonb) with ordinality as t(elem, ord);
    exception when others then
      converted := null;
    end;

    update spot_type_settings
       set key = 'series_styles',
           value = coalesce(converted, value)
     where spot_type_id = r.spot_type_id and key = 'rank_styles';
  end loop;
end
$$;

-- -------------------------------------------------------------
-- 4. spot_routes.series(ルートの色分け・絞り込み連動に使うシリーズ)。
--    旧実装はルート名(name)を種別のシリーズ値と突き合わせていたため、
--    既存行は name をそのまま series の初期値として引き継ぐ
-- -------------------------------------------------------------
alter table spot_routes add column if not exists series text;

update spot_routes r
   set series = r.name
 where r.series is null
   and exists (
     select 1 from spots s
      where s.spot_type_id = r.spot_type_id and s.series = r.name
   );

create index if not exists spot_routes_series_idx on spot_routes (series);

-- -------------------------------------------------------------
-- 5. visits.date_precision を廃止し、visited_on を timestamptz にする。
--    旧dateの値は「その日のJST 00:00」として解釈する(サーバーの
--    タイムゾーンに依存させないため明示的にAsia/Tokyoを指定)
-- -------------------------------------------------------------
alter table visits drop column if exists date_precision;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'visits' and column_name = 'visited_on'
       and data_type = 'date'
  ) then
    alter table visits
      alter column visited_on type timestamptz
      using visited_on::timestamp at time zone 'Asia/Tokyo';
  end if;
end
$$;

-- -------------------------------------------------------------
-- 6. 全テーブルに created_at / updated_at を持たせ、updated_at を
--    共通トリガーで自動更新する
-- -------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'spot_types', 'spot_type_settings', 'app_settings', 'users', 'spots',
    'spot_routes', 'spot_route_points', 'visits', 'visit_plans', 'reviews'
  ] loop
    execute format(
      'alter table %I add column if not exists created_at timestamptz not null default now()', t
    );
    execute format(
      'alter table %I add column if not exists updated_at timestamptz not null default now()', t
    );
    execute format('drop trigger if exists %I on %I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on %I for each row execute function set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end
$$;
