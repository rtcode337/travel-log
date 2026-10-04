-- 023: spot_location_checks(022)をやめる
--
-- 位置を確かめ済みかは、受け取る側(tazuna)がデータの側に印を付け、取り込むと
-- カテゴリ「位置確認済み」として届く。travel-log で別に記録を持つと、受け取る側に
-- ちゃんと反映されたかが分からないうえ、二重の記録になる。
--
-- 全文idempotent。
--
-- 適用はアプリ(scripts/migrate.mjs)が起動時に自動で行う。
-- トランザクションと schema_migrations への記録もそちらが受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

drop table if exists spot_location_checks;
