-- 017: 修正・追加の依頼(spot_flags)に「ここにスポットを足してほしい」を入れられるようにする
--
-- これまでの報告は既にあるスポットにしか付けられず、**地図に無いスポットを伝える
-- 手段が無かった**。地図の右クリックから「ここにスポット追加を依頼」できるようにし、
-- 同じ一覧(管理画面の「修正・追加の依頼」)に並べる。
--
-- 追加の依頼は指す先のスポットが無いので、spot_id を空にして座標と種別を持たせる。
-- どちらか一方は必ず持つ(check 制約)。1スポットに1つ(unique (spot_id))は
-- そのまま効く —— Postgres の unique は null どうしを別物として扱う。
-- 種別が消えれば追加の依頼も消える(修正の依頼がスポットと一緒に消えるのと同じ)。
--
-- 既存の行はどれも spot_id を持つので、この移行で内容は変わらない。
--
-- 全文idempotent。
--
-- 適用はアプリ(scripts/migrate.mjs)が起動時に自動で行う。
-- トランザクションと schema_migrations への記録もそちらが受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

alter table spot_flags alter column spot_id drop not null;

alter table spot_flags
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists spot_type_id uuid references spot_types (id) on delete cascade;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'spot_flags'::regclass
       and conname = 'spot_flags_target_ck'
  ) then
    alter table spot_flags
      add constraint spot_flags_target_ck
      check (
        spot_id is not null
        or (lat is not null and lng is not null and spot_type_id is not null)
      );
  end if;
end
$$;

create index if not exists spot_flags_spot_type_id_idx on spot_flags (spot_type_id);
