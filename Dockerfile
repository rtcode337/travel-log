FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ローカル開発用(docker-compose.dev.yml): next dev + ホットリロード
FROM deps AS dev
COPY . .
EXPOSE 7040
CMD ["npm", "run", "dev"]

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
# 写真とエクスポートの置き場。実運用ではホストのディレクトリを bind マウントするが、
# マウントせずに動かしたときも非 root で書けるように用意しておく
RUN mkdir -p /app/photos /app/exports && chown -R node:node /app/photos /app/exports /app/.next
# 待ち受けポート。standaloneのserver.jsはPORT環境変数を読む(next dev/start側は
# package.jsonのscriptsで-p 7040を指定していて、ここと両方を揃えて変えること)
ENV PORT=7040
EXPOSE 7040
# root で動かさない。node:24-alpine が持つ node ユーザーは uid/gid とも 1000 で、
# compose の user: の既定 (1000:1000) と一致する
USER node
CMD ["node", "server.js"]
