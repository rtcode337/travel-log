-- 009: 訪問記録エクスポートのジョブ(export_jobs)を追加
--
-- 訪問記録+写真のZIPを、管理者が対象ユーザーを指定してバックグラウンドで作る。
-- 作ったZIPはコンテナ内の /app/exports(ホストの ./exports をbindマウント)に置き、
-- この表にはそこからの相対パスだけを持つ(写真と同じ持ち方)。
--
-- 生成には時間がかかるので、実行はリクエストと切り離して status を進める:
--   running → done(file_path が入る) / failed(error が入る)
-- 同じユーザーのZIPは最新1件だけ残す(新しいものが done になった時点で前のものを消す)
-- ため、user_id ごとに実質1行だが、生成中と完成済みが一時的に併存するので
-- ユニーク制約は張らない。
--
-- 全文idempotent。
--
-- 適用はinitサービスが自動で行う(docker compose up で未適用分だけが走る)。
-- トランザクションと schema_migrations への記録は db/entrypoint.sh 側が受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

create table if not exists export_jobs (
  id           uuid primary key default gen_random_uuid(),
  -- エクスポートの対象(この人の訪問記録が入る)。退会したら結果も要らない
  user_id      uuid not null references users (id) on delete cascade,
  -- 実行した管理者。誰が作ったかの記録なので、退会しても結果は残す
  requested_by uuid references users (id) on delete set null,
  status       text not null default 'running'
                 check (status in ('running', 'done', 'failed')),
  -- exports/ からの相対パス(done のときだけ入る)
  file_path    text,
  file_size    bigint,
  visit_count  int,
  photo_count  int,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create index if not exists export_jobs_user_id_idx on export_jobs (user_id);

drop trigger if exists export_jobs_set_updated_at on export_jobs;
create trigger export_jobs_set_updated_at
  before update on export_jobs
  for each row execute function set_updated_at();
