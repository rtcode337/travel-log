-- 021: 修正の依頼(spot_flags)に「位置は正しい」を持たせる
--
-- 正しい位置に直した店が、収集を回す側の AI に別の回で動かされることがある。
-- 印を付けた店は、渡すテキストに `[位置確認]` の行として出し、受け取る側
-- (tazuna)が AI を通さずに座標を固定させる(Chiezo の locks)。
-- 位置確認は修正の依頼の一種なので、修正の依頼と同じく 1 スポットに 1 つ。
--
-- 既存の行はどれもふつうの修正の依頼なので false のまま。
--
-- 全文idempotent。
--
-- 適用はアプリ(scripts/migrate.mjs)が起動時に自動で行う。
-- トランザクションと schema_migrations への記録もそちらが受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

alter table spot_flags
  add column if not exists location_ok boolean not null default false;
