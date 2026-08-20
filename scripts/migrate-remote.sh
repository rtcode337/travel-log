#!/bin/sh
# 外部のPostgres(Supabase等)へスキーマ・マイグレーションを適用する。
#
# アプリと同じイメージで scripts/migrate.mjs を、接続先だけ差し替えて1回だけ走らせる
# —— 適用の中身はアプリが起動時に通るものそのままなので、Docker運用とホスティング先とで
# 当たるSQLがずれない。イメージは GHCR のものを pull する(手元でビルドしたものを
# 使いたいときは IMAGE=travel-log:local のように渡す)。
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

IMAGE="${IMAGE:-ghcr.io/rtcode337/travel-log:latest}"

echo "イメージを取得しています ($IMAGE)..."
docker pull -q "$IMAGE" >/dev/null

echo "$ENV_FILE の接続先へ適用します..."
# --env-file で渡す(コマンドラインに書くとパスワードが ps とシェル履歴に残る)。
# 接続先は DATABASE_URL が無ければ PG* から解決する(pg の既定の読み方)
docker run --rm --env-file "$ENV_FILE" "$IMAGE" node scripts/migrate.mjs
