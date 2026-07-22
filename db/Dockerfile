# DBの準備・マイグレーション適用用のイメージ。
# postgres公式イメージをそのまま使う(psql/pg_isreadyが入っており、
# サーバ本体と同じバージョンのクライアントで確実に接続できるため)。
#
# 2つの用途を1つのイメージのサブコマンドで賄う(docker-compose.yml参照):
#   prepare … db/data の作成と所有者調整(dbサービスの起動前)
#   migrate … スキーマ本体と未適用のマイグレーションSQLの自動適用(dbサービスの起動後)
#
# mainへのpushでGitHub Actions(.github/workflows/docker-publish.yml)が
# ghcr.io/<repo>-db-init として公開する。本番はこのイメージをpullして使う
FROM postgres:16-alpine

# スキーマ本体とマイグレーションSQLはイメージに焼き込む(本番ホストのリポジトリの
# 新旧に関わらず、pullしたイメージの中身がそのまま適用される)。
# /db 配下ではなく /init・/migrations に置く — prepareでは ./db をbindマウントするため、
# /db 配下だとマウントで隠れてしまう
COPY init /init
COPY migrations /migrations
COPY entrypoint.sh /usr/local/bin/db-init

RUN chmod +x /usr/local/bin/db-init

ENTRYPOINT ["/usr/local/bin/db-init"]
CMD ["migrate"]
