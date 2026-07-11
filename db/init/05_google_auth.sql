-- Google OAuth ログイン対応
-- 01_schema.sql が既に流れている既存DBに対して非破壊的に追従するためのマイグレーション。
-- 新規セットアップでは 01_schema.sql が既にこの形になっているため実質no-op。

alter table users alter column password_hash drop not null;
alter table users add column if not exists google_id text unique;

alter table users drop constraint if exists users_has_login_method;
alter table users add constraint users_has_login_method
  check (password_hash is not null or google_id is not null);
