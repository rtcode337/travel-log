-- 権限(管理者/モデレーター/一般ユーザー)とスポット承認フロー対応
-- 01_schema.sql が既に流れている既存DBに対して非破壊的に追従するためのマイグレーション。
-- 新規セットアップでは 01_schema.sql が既にこの形になっているため実質no-op。

alter table users add column if not exists role text not null default 'user';
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('admin', 'moderator', 'user'));

-- フェーズ1は単一ユーザー運用だったため、既存の唯一のアカウントを管理者に昇格する
update users set role = 'admin' where role = 'user';

alter table spots add column if not exists created_by uuid references users (id) on delete set null;
