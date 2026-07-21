import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 左下は自前のユーザーメニューボタンを置くため、開発インジケーターは右下に逃がす
  devIndicators: {
    position: "bottom-right",
  },
  // 本番用Dockerイメージ(Dockerfileのprodステージ)を最小構成にするため
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // 管理画面の破壊的操作(スポット全削除等)がconfirm()のみで守られているため、
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
