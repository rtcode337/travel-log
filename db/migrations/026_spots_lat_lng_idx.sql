-- 座標を指す画面の「近くのスポット」(GET /api/spots/nearby)を範囲検索で引くための索引。
create index if not exists spots_lat_lng_idx on spots (lat, lng);
