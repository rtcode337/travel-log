-- 024: 修正の依頼(spot_flags)に「この位置へ直して」の座標を持たせる(move_lat / move_lng)
--
-- 位置が微妙にだけ違うスポットを、スポット詳細でピンを動かして正しい位置を指せるようにする。
-- 渡すテキストに `[位置修正]` の行(今の座標 → 動かした先)で出し、受け取る側(tazuna)は
-- AI を通さずに、その座標で固定させる(Chiezo の locks)。
--
-- 依頼そのものの座標(lat / lng)は追加の依頼の場所なので使わず、別の列に持つ ——
-- 修正の依頼ではスポットの今の座標と並べて渡すので、両方が要る。
-- 修正の依頼の一種なので、修正の依頼と同じく 1 スポットに 1 つ。
--
-- 全文idempotent。
--
-- 適用はアプリ(scripts/migrate.mjs)が起動時に自動で行う。
-- トランザクションと schema_migrations への記録もそちらが受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

alter table spot_flags add column if not exists move_lat double precision;
alter table spot_flags add column if not exists move_lng double precision;
