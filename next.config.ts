import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 本番用Dockerイメージ(Dockerfileのprodステージ)を最小構成にするため
  output: "standalone",
  // 開発サーバをLAN内の別端末(スマホ実機での確認など)からホスト名・IPで開くと、
  // Next.jsは/_next配下の開発用リソース(JS・CSS)をクロスオリジンとして403で拒み、
  // 画面が真っ白になる。許可するホストは環境ごとに違うため、リポジトリに焼き込まず
  // 環境変数ALLOWED_DEV_ORIGINS(カンマ区切り。ポートは書かない)から読む。
  // **1つでも書くと「書いたものだけ」になる** —— localhost・127.0.0.1を落とすと
  // 開発機自身のブラウザからも真っ白になる(画面は200で返るのにJSが動かないので、
  // 原因が分かりにくい。実際に踏んだ)。
  // 本番(next start)には影響しない設定
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  // Postgresの実データ(data)と訪問写真(photos)はプロジェクト直下にbind
  // マウントされるため、既定のままだとDB書き込みのたびにnext devのファイル監視が
  // 再コンパイルを走らせてしまう(再コンパイル中は処理中のAPIリクエストが壊れる
  // ことがあり、CSVインポートのような連続リクエストが途中で失敗する)。
  // Next.js 16の既定バンドラーのTurbopackにはwatchOptions.ignored相当の設定が
  // 無いため、この除外を維持する目的でdev/buildとも--webpackを明示している
  // (package.jsonのscripts参照。Turbopack移行はこの除外の代替手段ができてから)
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/.next/**",
          "**/data/**",
          "**/photos/**",
          "**/tsconfig.tsbuildinfo",
        ],
      };
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // 管理画面の破壊的操作(公開スポットの全削除等)がconfirm()のみで守られているため、
          // iframe埋め込み経由のクリックジャッキングを防ぐ
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
