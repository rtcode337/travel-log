-- 口コミ機能: ユーザー1人につき1スポット1件のレビュー(rating+body)にする(upsert前提)
-- 01_schema.sql が既に流れている既存DBに対して非破壊的に追従するためのマイグレーション。
-- 新規セットアップでは 01_schema.sql が既にこの形になっているため実質no-op。

alter table reviews drop constraint if exists reviews_user_id_spot_id_key;
alter table reviews add constraint reviews_user_id_spot_id_key unique (user_id, spot_id);
