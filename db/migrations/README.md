# マイグレーション

`db/init/01_schema.sql`が「現在あるべきスキーマの唯一の定義」で、新規DBはそれだけで作られる。
このフォルダには、**既にデータが入っているDB(本番)を、旧スキーマから現在のスキーマへ
移行するためのスクリプト**を置く。

`01_schema.sql`自身も`schema_migrations`上では`000_init_schema`という名前の「一番先頭の
マイグレーション」として扱われる。空のDBには実行され、既にテーブルがあるDBには実行されず
適用済みとして記録されるだけなので、既存DBをそのまま引き継げる。

## 適用は自動

`docker compose up`すると`app`が待ち受けを始める前に(`scripts/migrate.mjs`)、
dbの起動を待って、スキーマ本体と未適用のスクリプトを連番順に当てる。手で流す必要はない。

- 適用済みのリビジョンは`schema_migrations`テーブルに記録され、2回目以降はスキップされる
- 適用に失敗したら**待ち受けに進まない**(古いスキーマのままアプリが動くのを防ぐ)。
  アプリが上がらないので失敗に気づける。理由は`docker compose logs app`の`migrate:`の行
- 1本のスクリプトとその適用記録は1トランザクションにまとまっている。途中で失敗すれば
  記録も残らないため、スクリプトを直して`docker compose up`し直せばよい

```bash
# 適用状況を見る
docker compose exec -T db psql -U travel_log -d travel_log -c "select version, applied_at from schema_migrations order by version"

# ログを見る(migrate: で始まる行)
docker compose logs app
```

## 書き方のルール

- `db/init/01_schema.sql`のテーブル定義を変更したら、必ず同じコミットでここにスクリプトを追加する
- ファイル名は`<連番>_<内容>.sql`(例: `001_series_categories.sql`)。連番の小さい順に適用され、
  ファイル名(拡張子を除く)がそのまま`schema_migrations.version`になる
- **`begin`/`commit`は書かない**。トランザクションは`scripts/migrate.mjs`が1本ずつ
  張る(スクリプト内で`commit`すると外側のトランザクションが切れてしまう)
- **`schema_migrations`へのinsertも書かない**。適用記録も`scripts/migrate.mjs`が行う
- 各スクリプトは冪等(idempotent)にする。`if not exists`・情報スキーマを見る`do $$ ... $$`ブロック等を使い、
  適用済みのDBに再度流しても害がないようにする。新規DB(最初から最新スキーマ)に対しても
  一度は実行されるため、そこで壊れないことが必要

## 新規DBでも必ず一度は流れる

**マイグレーションは「旧スキーマのDB」だけでなく「`01_schema.sql` で作った新規DB」にも
一度は当たる。** だから冪等なだけでは足りず、**現在のスキーマに対して無害である**ことまで
要る。実際に踏んだ例:

- `001` の `alter table spots rename column rank to series` は「rank 列がある」ことだけを
  条件にしていた。`010` でランク機能を入れ直して `spots.rank` が復活したため、新規DBでも
  改名しようとして `series already exists` で落ち、**新規セットアップが一切通らなくなっていた**
  (`docker compose up` も `scripts/migrate-remote.sh` も)。「series がまだ無い」ことまで
  条件に足して直した。索引の `spots_rank_idx → spots_series_idx` も同じ理由で落ちていた

**古い移行スクリプトが前提にしていた形は、あとから来たスクリプトが壊すことがある。**
列や索引を「戻す」変更を入れるときは、その名前を触っている過去のスクリプトを grep すること。

## 検証

新しいスクリプトを書いたら、次の2つを確認する。

**1. 新規DBに当たっても壊れないこと**(上記「新規DBでも必ず一度は流れる」)。
使い捨てDBを作って適用するだけで分かる。

```bash
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d postgres \
  -c "drop database if exists init_check" -c "create database init_check"
docker compose -f docker-compose.dev.yml run --rm --no-deps \
  -e DATABASE_URL=postgres://travel_log:travel_log@db:5432/init_check \
  app node scripts/migrate.mjs
```

あわせて `sh scripts/bootstrap-sql_test.sh` を流す(Supabase の SQL Editor へ貼る用の
一括SQLが、起動時の適用と同じ状態を作るかの突き合わせ)。

**2. 旧スキーマのダンプに当てた結果が新規作成したDBと一致すること。**使い捨てDBを2つ作って突き合わせるのが手軽。

```bash
# 1. 旧スキーマのダンプを復元したDBにマイグレーションを当てる
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d postgres -c "create database t_old"
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d t_old < <旧スキーマのダンプ>.sql
docker compose -f docker-compose.dev.yml run --rm -e PGDATABASE=t_old init

# 2. 最新スキーマで新規作成したDBを用意する
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d postgres -c "create database t_fresh"
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d t_fresh -v ON_ERROR_STOP=1 < db/init/01_schema.sql

# 3. information_schema.columns / pg_trigger / pg_indexes を突き合わせて差分が無いことを確認する
```

列の並び順だけはPostgresでは既存テーブルに対して変更できないため一致しないが、アプリは
常に列名で読み書きしているため影響しない。
