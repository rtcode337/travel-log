-- 訪問記録に「行った場所」(スポットのピンとは別の、実際に行った位置)を持たせる。
-- 空(両方null)ならスポットの位置で行ったものとして扱うので、既存の行は空のままでよい。
alter table visits add column if not exists place_lat double precision;
alter table visits add column if not exists place_lng double precision;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'visits_place_ck' and conrelid = 'visits'::regclass
  ) then
    alter table visits add constraint visits_place_ck check (
      (place_lat is null and place_lng is null)
      or (place_lat is not null and place_lng is not null
        and place_lat between -90 and 90 and place_lng between -180 and 180)
    );
  end if;
end $$;
