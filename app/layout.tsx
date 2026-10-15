import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppFrame from "@/components/AppFrame";

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
  // ページ自体のピンチズーム・入力フォーカス時の自動ズームを無効化する。
  // 自動ズームで下のタブバーが画面外に隠れるうえ、地図表示中はピンチ操作が
  // 地図の拡大縮小に取られてページのズームを元に戻す手段が無くなるため。
  // (地図自体の拡大縮小はMapLibreのジェスチャなので影響しない)
  maximumScale: 1,
  userScalable: false,
  // キーボードが出ても画面の枠(layout viewport)を縮めず、見えている範囲だけを狭める。
  // 枠が縮むと`h-dvh`の縦並びも縮み、最後に置いた下タブがキーボードのすぐ上に乗って
  // 書く場所を狭める。枠を縮めなければ下タブは枠の下端=キーボードの裏に隠れるので、
  // かつてJSで「入力中は帯を隠す」としていたのと同じ見え方をCSSだけで得られる。
  // iOSのSafariとAndroidのChrome(108以降)はもともとこの挙動だが、既定が
  // `resizes-content`のブラウザもあるので明示しておく
  interactiveWidget: "resizes-visual",
  themeColor: "#f9fafb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      {/* 画面の高さちょうどの縦並び。ページ全体はスクロールさせず、中身の領域だけを
          スクロールさせて下タブを最後に置く(fixedを使わない。理由はcomponents/AppFrame.tsx) */}
      <body className="flex h-dvh flex-col">
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
