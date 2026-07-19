FROM node:22-alpine AS deps
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

# 本番実行用(docker-compose.ymlのデフォルト): next buildの成果物のみを含む最小イメージ
FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# standalone出力はnext buildが実際にimportしたファイルしか含まないため、管理画面の
# 「SQLシードとの同期」機能(lib/sqlSeed.tsがfsで直接読む)向けに db/init を別途コピーする
COPY --from=builder /app/db/init ./db/init
EXPOSE 3000
CMD ["node", "server.js"]
