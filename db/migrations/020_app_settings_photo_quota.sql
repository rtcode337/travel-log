-- 020: ユーザーごとの写真の容量の上限を、アプリ全体の設定(app_settings)に持たせる
--
-- 上限は管理画面から変えられるようにする(環境変数だと変えるたびに再起動が要る)。
-- 単位はMB、0は「上限なし」。既定は 102400(=100GB)で、既にある行にもこの値が入る。
--
-- 全文idempotent。
--
-- 適用はアプリ(scripts/migrate.mjs)が起動時に自動で行う。
-- トランザクションと schema_migrations への記録もそちらが受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

alter table app_settings
  add column if not exists photo_quota_mb integer not null default 102400;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'app_settings_photo_quota_mb_check'
  ) then
    alter table app_settings
      add constraint app_settings_photo_quota_mb_check check (photo_quota_mb >= 0);
  end if;
end $$;
