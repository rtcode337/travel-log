-- 022: 「位置は正しい」を受け取る側へ渡したスポットの記録(spot_location_checks)
--
-- 「位置は正しい」は修正の依頼(spot_flags)の一種で、渡したあと一覧から消すと
-- 印も一緒に消え、どのスポットの位置を確かめ済みなのかが travel-log に残らなかった。
-- 依頼とは別に、スポットごとに「いつ確かめて渡したか」を残す。
--
-- 既に渡してある「位置は正しい」の依頼は、ここへ写す(渡した日時を確かめた日時とする)。
--
-- 全文idempotent。
--
-- 適用はアプリ(scripts/migrate.mjs)が起動時に自動で行う。
-- トランザクションと schema_migrations への記録もそちらが受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

create table if not exists spot_location_checks (
  spot_id     uuid primary key references spots (id) on delete cascade,
  checked_by  uuid references users (id) on delete set null,
  checked_at  timestamptz not null default now()
);

insert into spot_location_checks (spot_id, checked_by, checked_at)
select spot_id, flagged_by, forwarded_at
  from spot_flags
 where location_ok and spot_id is not null and forwarded_at is not null
on conflict (spot_id) do nothing;
