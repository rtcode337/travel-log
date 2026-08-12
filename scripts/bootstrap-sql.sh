#!/bin/sh
# スキーマ本体と全マイグレーションを、1回貼れば済む形のSQLにまとめて標準出力へ出す。
#
# **秘匿情報を手元に置かずにスキーマを流すための道**。Supabase の SQL Editor
# （ブラウザ。ログイン済みなので接続情報が要らない）に貼って実行する用で、
# scripts/migrate-remote.sh と違って接続先もパスワードも要らない。
#
#   sh scripts/bootstrap-sql.sh > /tmp/bootstrap.sql
#
# **schema_migrations への記録まで含める。** これが無いと、あとで
# migrate-remote.sh を使ったときに全部を流し直そうとして壊れる。
# 出力を当てたDBは、db/entrypoint.sh（composeの init サービス）が作るものと同じ状態になる
# （scripts/bootstrap-sql_test.sh がその一致を検証している）。
#
# 空でないDBには使わないこと。これは**初回投入用**で、途中から差分だけを当てる用途は
# 想定していない（そちらは migrate-remote.sh か、composeの init が受け持つ）。
set -eu

cd "$(dirname "$0")/.."

echo "-- travel-log スキーマ一括投入用SQL（scripts/bootstrap-sql.sh が生成）"
echo "-- Supabase の SQL Editor に貼って実行する。空のDBに対して1回だけ使うこと。"
echo

# 適用済みリビジョンの記録表。entrypoint.sh と同じくスクリプト側で作る
cat <<'SQL'
create table if not exists schema_migrations (
    version    text primary key,
    applied_at timestamptz not null default now()
);
SQL
echo

echo "-- ===== 000_init_schema (db/init/01_schema.sql) ====="
cat db/init/01_schema.sql
echo
echo "insert into schema_migrations (version) values ('000_init_schema') on conflict (version) do nothing;"
echo

for file in db/migrations/*.sql; do
    version=$(basename "$file" .sql)
    echo "-- ===== $version ====="
    cat "$file"
    echo
    echo "insert into schema_migrations (version) values ('$version') on conflict (version) do nothing;"
    echo
done
