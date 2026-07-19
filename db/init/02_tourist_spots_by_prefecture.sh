#!/bin/sh
# db/init/tourist_by_prefecture/*.sql (観光地データ、都道府県別)を読み込むラッパー。
# postgres公式イメージのdocker-entrypoint-initdb.dはサブディレクトリを走査しないため、
# このスクリプト自身を01_schema.sqlの直後(02_)に置いて都道府県コード順に読み込ませる。
# 実行可能ファイルとしてdocker-entrypoint.shから直接execされるため(sourceではない)、
# 同スクリプトのdocker_process_sql()関数は使えない。psqlを素で直接呼び出す。
set -e

for f in /docker-entrypoint-initdb.d/tourist_by_prefecture/*.sql; do
  echo "$0: running $f"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --no-password --dbname "$POSTGRES_DB" -f "$f"
done
