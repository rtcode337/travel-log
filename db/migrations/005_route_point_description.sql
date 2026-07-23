-- 005: spot_route_points.description(区間の説明)を追加
--
-- ルートの経由地ごとに「この経由地から次の経由地への移動」の説明(移動手段など)を
-- 持たせる。ルート詳細モーダルの経由地一覧で2点の間に表示する。最終地点には
-- 次の区間が無いため常にnull。ルート全体の説明は従来どおりspot_routes.description。
-- ルートCSV(routes.csv)の省略可のleg_description列から取り込む。全文idempotent。
--
-- 適用はdb-migrateサービスが自動で行う(docker compose up で未適用分だけが走る)。
-- トランザクションと schema_migrations への記録は db/entrypoint.sh 側が受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

alter table spot_route_points add column if not exists description text;
