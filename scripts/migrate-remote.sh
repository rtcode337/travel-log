#!/bin/sh
# 外部のPostgres(Supabase等)へスキーマ・マイグレーションを適用する。
#
# composeの init サービスと同じイメージ(db/Dockerfile)を、接続先だけ差し替えて
# 1回だけ走らせる —— 適用の中身は db/entrypoint.sh そのままなので、Docker運用と
# ホスティング先とで当たるSQLがずれない。
#
# 使い方:
#   1. .env.remote を作る(.env.remote.example をコピーして値を入れる。gitignore済み)
#   2. sh scripts/migrate-remote.sh
#
# 接続先は**セッションプーラー(5432)か直接接続**にすること。トランザクション
# プーラー(6543)はアプリの通常クエリ向けで、advisory lockを張ったままの
# 複数文にわたるDDLには向かない。
set -eu

cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env.remote}"
if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE がありません。.env.remote.example をコピーして値を入れてください。" >&2
  exit 1
fi

echo "イメージをビルドしています..."
docker build -q -t travel-log-db-init ./db >/dev/null

echo "$ENV_FILE の接続先へ適用します..."
# --env-file で渡す(コマンドラインに書くとパスワードが ps とシェル履歴に残る)
docker run --rm --env-file "$ENV_FILE" --tmpfs /var/lib/postgresql travel-log-db-init
