import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 左下は自前のユーザーメニューボタンを置くため、開発インジケーターは右下に逃がす
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;
