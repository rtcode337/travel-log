-- 口コミを星評価付きレビューではなく、テキストのみのシンプルな口コミにする
-- 01_schema.sql が既に流れている既存DBに対して非破壊的に追従するためのマイグレーション。
-- 新規セットアップでは 01_schema.sql が既にこの形になっているため実質no-op。

alter table reviews drop column if exists rating;
update reviews set body = '' where body is null;
alter table reviews alter column body set not null;
