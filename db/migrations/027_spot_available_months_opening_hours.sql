-- スポットに「提供の時期」(手に入る月)と「営業時間」を持たせる。
-- どちらもnullが「通年か不明」「不明」なので、既存の行は空のままでよい。
alter table spots add column if not exists available_months text;
alter table spots add column if not exists opening_hours text;

-- 提供の時期の字面の検査(01_schema.sqlと同じ式。整えた形は lib/availableMonths.ts)
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'spots_available_months_ck' and conrelid = 'spots'::regclass
  ) then
    alter table spots add constraint spots_available_months_ck check (
      available_months ~ '^(1[0-2]|[1-9])(-(1[0-2]|[1-9]))?(,(1[0-2]|[1-9])(-(1[0-2]|[1-9]))?)*$'
    );
  end if;
end $$;
