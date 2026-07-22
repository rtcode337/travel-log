#!/bin/sh
# DBの準備・マイグレーション適用(db/Dockerfile のENTRYPOINT)。
#
#   db-init prepare … db/data の作成と所有者調整。dbサービスの起動前に走る
#   db-init migrate … スキーマ本体(/init/01_schema.sql)と /migrations の未適用SQLを
#                     適用する。dbサービスの起動後に走る
#
# どちらも1回実行して終了するワンショット(compose側は restart: "no")。
set -eu

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"
SCHEMA_FILE="${SCHEMA_FILE:-/init/01_schema.sql}"
# スキーマ本体をschema_migrationsに記録するときのバージョン名(常に連番の先頭)
SCHEMA_VERSION=000_init_schema
# マイグレーションの同時実行を防ぐためのadvisory lockのキー(任意の定数)
LOCK_KEY=8241973

prepare() {
  # db/dataは.gitignore対象でgit管理下になく、cloneした直後は存在しない。dbサービスが
  # 直接./db/dataをbindマウントすると、環境によってはホスト側にディレクトリがない状態で
  # コンテナ起動そのものが失敗しうるため、ここで先に作ってpostgres(uid/gid 70)に
  # 所有者を揃えておく。
  # ここで触るのはgit管理外のdb/dataだけにすること — かつてはdb/initにもchmodを
  # かけていたが、git管理下のファイルのパーミッションをrootで書き換えるため、
  # db/init/01_schema.sqlに変更が入るとホスト側のgit pullが失敗するようになっていた
  # (スキーマ本体はdbサービスにマウントせず、migrate側が流す方式に変えて解消した)
  mkdir -p /db/data
  chown -R 70:70 /db/data
  echo "db-init: prepared /db/data"
}

wait_for_db() {
  # compose側でdbのhealthcheck完了を待ってから起動する想定だが、
  # 単体で起動された場合にも耐えるよう自前でも待つ
  i=0
  until pg_isready -q; do
    i=$((i + 1))
    if [ "$i" -ge 60 ]; then
      echo "db-init: database did not become ready in 60s" >&2
      exit 1
    fi
    sleep 1
  done
}

migrate() {
  wait_for_db

  # 適用済みリビジョンの記録テーブル。マイグレーション自身ではなくこのスクリプトが作る
  # (新規DBでもこのテーブルだけは必ず存在する状態にするため)
  psql -v ON_ERROR_STOP=1 -q -c "
    create table if not exists schema_migrations (
      version    text primary key,
      applied_at timestamptz not null default now()
    )"

  # スキーマ本体。postgresのdocker-entrypoint-initdb.dに任せず、ここで流す
  # (db/initをdbコンテナにマウントしないため、ホスト側のファイルのパーミッションを
  #  一切触らずに済む)。既にテーブルがあるDB(旧方式でinitdbが作ったもの)は
  # 実行せず「適用済み」として記録するだけにする
  if [ -z "$(psql -tAc "select 1 from schema_migrations where version = '$SCHEMA_VERSION'")" ]; then
    if [ -n "$(psql -tAc "select to_regclass('public.spot_types')")" ]; then
      echo "db-init: schema already exists, marking $SCHEMA_VERSION as applied"
      psql -v ON_ERROR_STOP=1 -q \
        -c "insert into schema_migrations (version) values ('$SCHEMA_VERSION')
            on conflict (version) do nothing"
    else
      echo "db-init: applying $SCHEMA_VERSION"
      psql -v ON_ERROR_STOP=1 --single-transaction -q \
        -c "do \$\$ begin perform pg_advisory_xact_lock($LOCK_KEY); end \$\$" \
        -f "$SCHEMA_FILE" \
        -c "insert into schema_migrations (version) values ('$SCHEMA_VERSION')
            on conflict (version) do nothing"
    fi
  fi

  applied=0
  skipped=0
  # シェルのグロブは辞書順に展開されるため、001_/002_ の連番順に適用される
  for file in "$MIGRATIONS_DIR"/*.sql; do
    [ -e "$file" ] || break
    version=$(basename "$file" .sql)

    if [ -n "$(psql -tAc "select 1 from schema_migrations where version = '$version'")" ]; then
      skipped=$((skipped + 1))
      continue
    fi

    echo "db-init: applying $version"
    # SQL本体と適用記録を1トランザクションにまとめる(途中で失敗したら
    # 記録も残らないので、直して再実行すればよい)。advisory lockは
    # 複数のrunnerが同時に走った場合に二重適用しないためのもの
    psql -v ON_ERROR_STOP=1 --single-transaction -q \
      -c "do \$\$ begin perform pg_advisory_xact_lock($LOCK_KEY); end \$\$" \
      -f "$file" \
      -c "insert into schema_migrations (version) values ('$version')
          on conflict (version) do nothing"
    applied=$((applied + 1))
  done

  echo "db-init: migrations done (applied=$applied, skipped=$skipped)"
}

case "${1:-migrate}" in
  prepare) prepare ;;
  migrate) migrate ;;
  *)
    echo "usage: db-init [prepare|migrate]" >&2
    exit 64
    ;;
esac
