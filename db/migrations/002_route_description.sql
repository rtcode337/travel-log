-- 002: spot_routes.description(ルートの説明文)を追加
--
-- 地図でルートの線をタップすると出るルート詳細に表示する。
-- ルートCSV(routes.csv)の省略可のdescription列から取り込む。全文idempotent。
--
-- 適用はdb-migrateサービスが自動で行う(docker compose up で未適用分だけが走る)。
-- トランザクションと schema_migrations への記録は db/entrypoint.sh 側が受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

alter table spot_routes add column if not exists description text;
