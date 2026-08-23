FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ローカル開発用(docker-compose.dev.yml): next dev + ホットリロード
FROM deps AS dev
COPY . .
EXPOSE 7040
# 本番と同じく、起動のたびに未適用のマイグレーションを当ててから開発サーバを上げる
CMD ["sh", "-c", "node scripts/migrate.mjs && npm run dev"]

# 本番ビルド用の中間ステージ
FROM deps AS builder
COPY . .
RUN npm run build

# 本番実行用: next buildの成果物のみを含む最小イメージ。mainへのpushでGitHub Actionsが
# このステージをビルドしてGHCRへ公開し、docker-compose.ymlのappサービスがそれを参照する
FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
# GitHub Actionsが --build-arg BUILD_NUMBER=<JST日時>-<短縮コミットハッシュ> で渡すビルド番号。
# 管理画面(app/[type]/admin)がリクエスト時にこの環境変数を読んで表示する。
# ビルド時に埋め込まず実行時に読むためnext buildのキャッシュには影響しない(未指定なら空=開発ビルド扱い)
ARG BUILD_NUMBER=""
ENV BUILD_NUMBER=$BUILD_NUMBER
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# output: standaloneは.next/staticとpublicをコピーしないため別途持ち込む。
# publicにはPWAのアイコン(public/icons)と、MapLibreのワーカースクリプト
# (public/maplibre-gl。builderのprebuildが生成する。lib/maplibre.ts参照)が入る
COPY --from=builder /app/public ./public
# スキーマ本体とマイグレーションSQL、それを当てるスクリプト。起動のたびに未適用ぶんを
# 当ててから待ち受ける(かつては psql を積んだ専用イメージとinitサービスの仕事だった)
COPY --from=builder /app/db/init ./db/init
COPY --from=builder /app/db/migrations ./db/migrations
COPY --from=builder /app/scripts/migrate.mjs ./scripts/migrate.mjs
# 写真とエクスポートの置き場。実運用ではホストのディレクトリを bind マウントするが、
# マウントせずに動かしたときも非 root で書けるように用意しておく
# 実行ユーザーは **ホストに実在しない uid 10001**。node イメージが持つ node ユーザーは
# uid 1000 = ホストの1人目のユーザーの番号で、それで動かすと万一コンテナから
# 抜け出されたときにそのユーザーのファイルを触れる立場になる。10001 ならホストの
# 誰でもなく、chown で渡した data/ しか触れない
RUN addgroup -g 10001 app && adduser -S -D -G app -u 10001 -h /home/app app \
    && mkdir -p /app/photos /app/exports \
    && chown -R 10001:10001 /app/photos /app/exports /app/.next /home/app \
    && chmod 1777 /home/app
# 待ち受けポート。standaloneのserver.jsはPORT環境変数を読む(next dev/start側は
# package.jsonのscriptsで-p 7040を指定していて、ここと両方を揃えて変えること)
ENV PORT=7040
EXPOSE 7040
# root で動かさない。compose の user: の既定 (10001:10001) と一致する。
# HOME を 1777 で用意してあるのは、`.env` で別の uid を指定されたときに
# /etc/passwd に載らないユーザーになり、HOME が / に落ちて書けなくなるため
ENV HOME=/home/app
USER 10001:10001
# マイグレーションが失敗したら待ち受けに進まない(古いスキーマのままアプリが動くのを
# 防ぐ)。exec で server.js を PID 1 にして、シグナルがそのまま届くようにする
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]
