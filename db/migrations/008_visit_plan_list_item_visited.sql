-- 008: 訪問予定リストの経由スポットに「訪問済み」フラグ(visited_at)を追加
--
-- 訪問記録を付けたスポットを訪問予定リストから消すのをやめ、代わりにこの列へ
-- 日時を入れて「訪問済み」を示す(nullなら未訪問)。訪問済みの経由スポットは
-- 地図の経路とGoogle マップの経路検索から外れるが、リストには残り続けるので
-- 旅程として何を回ったかを後から辿れる。手で付け外しもできる。
--
-- 全文idempotent。
--
-- 適用はinitサービスが自動で行う(docker compose up で未適用分だけが走る)。
-- トランザクションと schema_migrations への記録は db/entrypoint.sh 側が受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

alter table visit_plan_list_items
  add column if not exists visited_at timestamptz;
