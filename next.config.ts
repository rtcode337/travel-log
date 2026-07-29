import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 左下は自前のユーザーメニューボタンを置くため、開発インジケーターは右下に逃がす
  devIndicators: {
    position: "bottom-right",
  },
  // 本番用Dockerイメージ(Dockerfileのprodステージ)を最小構成にするため
  output: "standalone",
  // Postgresの実データ(db/data)と訪問写真(photos)はプロジェクト直下にbind
  // マウントされるため、既定のままだとDB書き込みのたびにnext devのファイル監視が
  // 再コンパイルを走らせてしまう(再コンパイル中は処理中のAPIリクエストが壊れる
  // ことがあり、CSVインポートのような連続リクエストが途中で失敗する)
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/.next/**",
          "**/db/data/**",
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
