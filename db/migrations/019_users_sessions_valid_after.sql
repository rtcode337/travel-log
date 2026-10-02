-- 019: ユーザーごとに「この時刻より前に発行したセッションは無効」を持たせる
--
-- セッションは署名付きCookieで、ログアウトしてもCookieを消すだけだったため、
-- 漏れたCookieや他の端末に残ったログインを取り消す手段が無かった。
-- 「すべての端末からログアウト」でこの列に現在時刻を入れ、それより前に
-- 発行されたCookieを受け付けないようにする。null は「制限なし」。
--
-- 全文idempotent。
--
-- 適用はアプリ(scripts/migrate.mjs)が起動時に自動で行う。
-- トランザクションと schema_migrations への記録もそちらが受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

alter table users
  add column if not exists sessions_valid_after timestamptz;
