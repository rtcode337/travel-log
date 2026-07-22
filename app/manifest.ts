import type { MetadataRoute } from "next";

// /manifest.webmanifest として配信される(Next.jsのMetadata Files規約)。
// このパスはmiddleware.tsの認証ガードから除外している — ブラウザのmanifest取得は
// 既定でCookieを送らないため、ガード対象のままだと/loginへのリダイレクトになり
// インストール不能になる。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Travel Log",
    short_name: "Travel Log",
    description: "観光地への訪問記録を主役にしたアプリ",
    start_url: "/",
    display: "standalone",
    background_color: "#f9fafb",
    theme_color: "#f9fafb",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
