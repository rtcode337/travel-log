FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ローカル開発用(docker-compose.dev.yml): next dev + ホットリロード
FROM deps AS dev
COPY . .
EXPOSE 3000
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
EXPOSE 3000
CMD ["node", "server.js"]
