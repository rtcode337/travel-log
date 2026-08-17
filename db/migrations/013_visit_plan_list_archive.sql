-- 013: 訪問予定リストに「アーカイブ」(archived_at)を追加
--
-- 回り終わった旅程を一覧から下げるための印。削除と違って中身はそのまま残り、
-- アーカイブの一覧(スポット画面の訪問予定リストから開く)から読み直せる。
-- null なら通常のリスト。アーカイブ済みは通常の一覧・地図の経路・
-- 「リストに追加」の対象から外れる。
--
-- 全文idempotent。
--
-- 適用はinitサービスが自動で行う(docker compose up で未適用分だけが走る)。
-- トランザクションと schema_migrations への記録は db/entrypoint.sh 側が受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

alter table visit_plan_lists
  add column if not exists archived_at timestamptz;
