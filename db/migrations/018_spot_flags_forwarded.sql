-- 018: 修正・追加の依頼(spot_flags)に「受け取る側へ渡したか」を持たせる
--
-- 依頼はテキストにして収集を回す側へ渡すが、これまでは一覧のどれを渡したのかが
-- 残らず、片付くまで一覧に居続ける依頼と、まだ渡していない依頼の見分けが
-- 付かなかった。渡した日時を forwarded_at に持ち、空なら「未依頼」、入っていれば
-- 「対応中」として一覧に出す。
--
-- 既存の行は渡したかどうかが分からないので、未依頼(null)のままにする。
--
-- 全文idempotent。
--
-- 適用はアプリ(scripts/migrate.mjs)が起動時に自動で行う。
-- トランザクションと schema_migrations への記録もそちらが受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

alter table spot_flags
  add column if not exists forwarded_at timestamptz;
