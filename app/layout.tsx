import type { Metadata, Viewport } from "next";
import "./globals.css";
import NavBar from "@/components/NavBar";

export const metadata: Metadata = {
  title: "Travel Log — 観光地訪問記録",
  description: "観光地への訪問記録を主役にしたアプリ",
  // iOS Safariはmanifestのdisplay/iconsを見ないため、ホーム画面追加用の設定は
  // こちら(apple-mobile-web-app-*メタタグとapp/apple-icon.png)で別途指定する
  appleWebApp: {
    capable: true,
    title: "Travel Log",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f9fafb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="flex min-h-dvh flex-col">
        <div className="flex-1 pb-16">{children}</div>
        <NavBar />
      </body>
    </html>
  );
}
