#!/bin/sh
# scripts/bootstrap-sql.sh の出力を当てたDBが、アプリが起動時に通る適用経路
# （scripts/migrate.mjs）が作るDBと同じ状態になることを確かめる。
#
# **この一致が崩れると気づけない**のが怖いところ ——「貼ったのにアプリが動かない」
# 「あとで migrate-remote.sh が全部流し直そうとする」という形で後から出る。
# 新しいマイグレーションを足したら流すこと。
#
#   docker compose -f docker-compose.dev.yml up -d db   # 先に起動しておく
#   sh scripts/bootstrap-sql_test.sh
set -eu

cd "$(dirname "$0")/.."
DC="docker compose -f docker-compose.dev.yml"
PSQL="$DC exec -T db psql -U travel_log"
TMP="${TMPDIR:-/tmp}/travel-log-bootstrap-check"
mkdir -p "$TMP"

echo "1. 使い捨てDBを2つ作る"
$PSQL -d postgres -q \
  -c "drop database if exists bootstrap_check" -c "drop database if exists init_check" \
  -c "create database bootstrap_check" -c "create database init_check"

echo "2. bootstrap-sql.sh の出力を当てる"
sh scripts/bootstrap-sql.sh | $PSQL -d bootstrap_check -q -v ON_ERROR_STOP=1

echo "3. アプリの起動時と同じ経路で当てる"
$DC run --rm --no-deps \
  -e DATABASE_URL=postgres://travel_log:travel_log@db:5432/init_check \
  app node scripts/migrate.mjs >/dev/null

echo "4. 突き合わせ"
dump() {
  $PSQL -tA -d "$1" -c "
    select 'COLUMN '||table_name||'.'||column_name||' '||data_type||' '||is_nullable
      from information_schema.columns where table_schema='public'
    union all
    select 'INDEX  '||indexname||' '||indexdef from pg_indexes where schemaname='public'
    union all
    select 'TRIGGER '||tgname||' on '||tgrelid::regclass::text
      from pg_trigger where not tgisinternal
    union all
    select 'MIGRATION '||version from schema_migrations
    order by 1"
}
dump bootstrap_check > "$TMP/bootstrap.txt"
dump init_check      > "$TMP/init.txt"

if diff -u "$TMP/init.txt" "$TMP/bootstrap.txt"; then
  echo "OK: 列・索引・トリガー・適用記録がすべて一致（$(wc -l < "$TMP/init.txt") 項目）"
else
  echo "NG: 差分あり" >&2
  exit 1
fi

$PSQL -d postgres -q -c "drop database bootstrap_check" -c "drop database init_check"
