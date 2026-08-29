-- 015: 公開スポットへの「間違い報告」(spot_flags)を追加
--
-- 管理者(spot_admin/admin)が地図のスポット詳細から報告する印(画面の表示名は
-- 「間違い報告」)。理由は空でもよい(気づいた時点で印だけ付けられるようにするため)。
-- 管理画面に一覧で出し、スポット名と理由をまとめてテキストにしてAIへ渡す・
-- まとめて取り消す、で片付ける。
-- 1スポットに1つだけ(unique)で、スポットが消えれば cascade で報告も消える。
--
-- 全文idempotent(create table if not exists / create index if not exists と、
-- トリガーは有無を見てから作る)。
--
-- 適用はアプリの起動時に自動で行われる(docker compose up で未適用分だけが走る)。
-- トランザクションと schema_migrations への記録は scripts/migrate.mjs 側が
-- 受け持つため、このファイルに begin/commit や記録のinsertは書かない。

create table if not exists spot_flags (
  id         uuid primary key default gen_random_uuid(),
  spot_id    uuid not null references spots (id) on delete cascade,
  reason     text not null default '',
  flagged_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (spot_id)
);

create index if not exists spot_flags_spot_id_idx on spot_flags (spot_id);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'spot_flags_set_updated_at'
  ) then
    create trigger spot_flags_set_updated_at
      before update on spot_flags
      for each row execute function set_updated_at();
  end if;
end
$$;
