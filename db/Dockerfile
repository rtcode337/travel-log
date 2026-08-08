# スキーマ・マイグレーション適用用のイメージ(composeの init サービス)。
# postgres公式イメージをそのまま使う(psql/pg_isreadyが入っており、
# サーバ本体と同じバージョンのクライアントで確実に接続できるため)。
#
# mainへのpushでGitHub Actions(.github/workflows/docker-publish.yml)が
# ghcr.io/<repo>-db-init として公開する。本番はこのイメージをpullして使う
# (かつては db/data の準備(prepare)も担っていた名残でこのイメージ名。
#  サービス名を変えてもイメージ名を変えると GHCR 側の整理が要るため据え置き)
FROM postgres:18-alpine

# スキーマ本体とマイグレーションSQLはイメージに焼き込む(本番ホストのリポジトリの
# 新旧に関わらず、pullしたイメージの中身がそのまま適用される)
COPY init /init
COPY migrations /migrations
COPY entrypoint.sh /usr/local/bin/db-init

RUN chmod +x /usr/local/bin/db-init

ENTRYPOINT ["/usr/local/bin/db-init"]
