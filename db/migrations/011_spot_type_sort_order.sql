-- 011: spot_types に sort_order(画面に並べる順)を追加
--
-- それまでは作成順(created_at)固定で、地図の種別切り替えメニュー・管理画面の
-- 一覧の並びを変えられなかった。既定値0を入れるだけで、既存の並び(作成順)は
-- 変わらない —— 並びは (sort_order, created_at) の順で解決する。

alter table spot_types add column if not exists sort_order integer not null default 0;
