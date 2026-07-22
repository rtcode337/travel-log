# マイグレーション

`db/init/01_schema.sql`が「現在あるべきスキーマの唯一の定義」で、新規DBはそれだけで作られる。
このフォルダには、**既にデータが入っているDB(本番)を、旧スキーマから現在のスキーマへ
移行するためのスクリプト**を置く。

`01_schema.sql`自身も`schema_migrations`上では`000_init_schema`という名前の「一番先頭の
マイグレーション」として扱われる。空のDBには実行され、既にテーブルがあるDBには実行されず
適用済みとして記録されるだけなので、既存DBをそのまま引き継げる。

## 適用は自動

`docker compose up`すると`db-migrate`サービス(`db/Dockerfile`のイメージ、`migrate`サブコマンド)が
dbの起動を待って、スキーマ本体と未適用のスクリプトを連番順に当てる。手で流す必要はない。

- 適用済みのリビジョンは`schema_migrations`テーブルに記録され、2回目以降はスキップされる
- `app`サービスは`db-migrate`が**正常終了するまで起動しない**(古いスキーマのままアプリが
  動くのを防ぐ)。マイグレーションが失敗したらアプリも上がらないので、失敗に気づける
- 1本のスクリプトとその適用記録は1トランザクションにまとまっている。途中で失敗すれば
  記録も残らないため、スクリプトを直して`docker compose up`し直せばよい

```bash
# 適用状況を見る
docker compose exec -T db psql -U travel_log -d travel_log -c "select version, applied_at from schema_migrations order by version"

# ログを見る
docker compose logs db-migrate
```

## 書き方のルール

- `db/init/01_schema.sql`のテーブル定義を変更したら、必ず同じコミットでここにスクリプトを追加する
- ファイル名は`<連番>_<内容>.sql`(例: `001_series_categories.sql`)。連番の小さい順に適用され、
  ファイル名(拡張子を除く)がそのまま`schema_migrations.version`になる
- **`begin`/`commit`は書かない**。トランザクションは`db/entrypoint.sh`が`--single-transaction`で
  張る(スクリプト内で`commit`すると外側のトランザクションが切れてしまう)
- **`schema_migrations`へのinsertも書かない**。適用記録も`db/entrypoint.sh`が行う
- 各スクリプトは冪等(idempotent)にする。`if not exists`・情報スキーマを見る`do $$ ... $$`ブロック等を使い、
  適用済みのDBに再度流しても害がないようにする。新規DB(最初から最新スキーマ)に対しても
  一度は実行されるため、そこで壊れないことが必要

## 検証

新しいスクリプトを書いたら、**旧スキーマのダンプに当てた結果が新規作成したDBと一致すること**を
確認する。使い捨てDBを2つ作って突き合わせるのが手軽。

```bash
# 1. 旧スキーマのダンプを復元したDBにマイグレーションを当てる
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d postgres -c "create database t_old"
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d t_old < <旧スキーマのダンプ>.sql
docker compose -f docker-compose.dev.yml run --rm -e PGDATABASE=t_old db-migrate

# 2. 最新スキーマで新規作成したDBを用意する
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d postgres -c "create database t_fresh"
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d t_fresh -v ON_ERROR_STOP=1 < db/init/01_schema.sql

# 3. information_schema.columns / pg_trigger / pg_indexes を突き合わせて差分が無いことを確認する
```

列の並び順だけはPostgresでは既存テーブルに対して変更できないため一致しないが、アプリは
常に列名で読み書きしているため影響しない。
