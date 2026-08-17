-- 014: 訪問記録への「追記」(visit_notes)を追加
--
-- 後から思い出したこと・分かったことを、**訪問回数を増やさずに**同じ訪問記録へ
-- ぶら下げるための表。1つの訪問記録に何件でも付き、画面では「<作成日時>に追記」として
-- 元の記録の下(写真も元の写真の後ろ)に古い順で並ぶ。
-- 所有者は visits 側の user_id で決まるためこの表には持たない
-- (訪問記録が消えれば cascade で追記も消える)。
--
-- 全文idempotent(create table if not exists / create index if not exists と、
-- トリガーは有無を見てから作る)。
--
-- 適用はinitサービスが自動で行う(docker compose up で未適用分だけが走る)。
-- トランザクションと schema_migrations への記録は db/entrypoint.sh 側が受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

create table if not exists visit_notes (
  id         uuid primary key default gen_random_uuid(),
  visit_id   uuid not null references visits (id) on delete cascade,
  body       text,
  photos     text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists visit_notes_visit_id_idx on visit_notes (visit_id);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'visit_notes_set_updated_at'
  ) then
    create trigger visit_notes_set_updated_at
      before update on visit_notes
      for each row execute function set_updated_at();
  end if;
end
$$;
