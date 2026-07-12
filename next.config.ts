import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 左下は自前のユーザーメニューボタンを置くため、開発インジケーターは右下に逃がす
  devIndicators: {
    position: "bottom-right",
  },
  // 本番用Dockerイメージ(Dockerfileのprodステージ)を最小構成にするため
  output: "standalone",
};

export default nextConfig;
