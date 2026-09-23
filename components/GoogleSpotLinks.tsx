"use client";

import { buildGeminiAskUrl } from "@/lib/askAi";
import { DirectionsIcon } from "@/components/GoogleMapsRouteLink";
import { useRouteOrigin } from "@/lib/useRouteOrigin";
import type { Spot, SpotType } from "@/lib/types";

/** Google Geminiの公式ロゴマーク(Simple Icons、CC0) */
function GeminiIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" />
    </svg>
  );
}

/** Google マップの公式ロゴマーク(Simple Icons、CC0) */
function GoogleMapsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M19.527 4.799c1.212 2.608.937 5.678-.405 8.173-1.101 2.047-2.744 3.74-4.098 5.614-.619.858-1.244 1.75-1.669 2.727-.141.325-.263.658-.383.992-.121.333-.224.673-.34 1.008-.109.314-.236.684-.627.687h-.007c-.466-.001-.579-.53-.695-.887-.284-.874-.581-1.713-1.019-2.525-.51-.944-1.145-1.817-1.79-2.671L19.527 4.799zM8.545 7.705l-3.959 4.707c.724 1.54 1.821 2.863 2.871 4.18.247.31.494.622.737.936l4.984-5.925-.029.01c-1.741.601-3.691-.291-4.392-1.987a3.377 3.377 0 0 1-.209-.716c-.063-.437-.077-.761-.004-1.198l.001-.007zM5.492 3.149l-.003.004c-1.947 2.466-2.281 5.88-1.117 8.77l4.785-5.689-.058-.05-3.607-3.035zM14.661.436l-3.838 4.563a.295.295 0 0 1 .027-.01c1.6-.551 3.403.15 4.22 1.626.176.319.323.683.377 1.045.068.446.085.773.012 1.22l-.003.016 3.836-4.561A8.382 8.382 0 0 0 14.67.439l-.009-.003zM9.466 5.868L14.162.285l-.047-.012A8.31 8.31 0 0 0 11.986 0a8.439 8.439 0 0 0-6.169 2.766l-.016.018 3.665 3.084z" />
    </svg>
  );
}

/** 画像アイコン(Google Material Symbols「image」、Apache License 2.0) */
function GoogleImagesIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
    </svg>
  );
}

/**
 * スポットについてGoogleで調べる導線(地図・経路・画像検索・Gemini)。
 * スポット詳細と、地図の訪問予定リスト作成中の追加確認で共用する ——
 * どちらも「この場所に行くかどうか」を決める場面で、同じものが要る。
 *
 * 並びは軽いものから重いものへ(地図 → 経路 → 画像検索 → Gemini)。
 * 押せばすぐ答えが出るものを先に、読むのに時間がかかるものを最後に置く。
 *
 * アイコンだけの行にしてある。文字のリンクを混ぜると狭い画面で折り返し、
 * アイコンの列が2行に割れて読みにくくなる。
 */
export default function GoogleSpotLinks({
  spot,
  spotType,
  className = "",
}: {
  spot: Spot;
  /** Geminiへの質問に添える種別(同じ場所でも種別によって知りたいことが違う) */
  spotType?: SpotType | null;
  className?: string;
}) {
  // 経路の出発地。権限が既に許可されているときだけ取れる(取れなければoriginなし)
  const routeOrigin = useRouteOrigin();
  return (
    <div className={`flex items-center gap-1 text-sm text-gray-500 ${className}`}>
      Google:
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${spot.name} ${spot.lat},${spot.lng}`
        )}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Google マップで開く"
        title="Google マップで開く"
        className="rounded p-1 text-blue-600 hover:bg-blue-50"
      >
        <GoogleMapsIcon className="size-5" />
      </a>
      <a
        href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
          `${spot.lat},${spot.lng}`
        )}${
          routeOrigin
            ? `&origin=${encodeURIComponent(`${routeOrigin.lat},${routeOrigin.lng}`)}`
            : ""
        }`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Google マップで経路を表示"
        title="Google マップで経路を表示"
        className="rounded p-1 text-blue-600 hover:bg-blue-50"
      >
        <DirectionsIcon className="size-5" />
      </a>
      {/* Google の画像検索(`udm=2`が画像タブ。AIモードの`udm=50`と同じ渡し方)。
          文章より写真のほうが早い場面がある —— 見た目が分かれば
          「行くかどうか」も「着いたときにそれと分かるか」も判断できる。
          検索語に座標は入れない(名前と所在地で引く) ——
          地図・経路と違って画像検索は座標を地名として扱わないため、
          数字が混ざるとかえって関係のない画像が並ぶ */}
      <a
        href={`https://www.google.com/search?udm=2&q=${encodeURIComponent(
          [spot.name, spot.region].filter(Boolean).join(" ")
        )}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Google 画像検索でこのスポットを見る"
        title="Google 画像検索でこのスポットを見る"
        className="rounded p-1 text-blue-600 hover:bg-blue-50"
      >
        <GoogleImagesIcon className="size-5" />
      </a>
      {/* 検索のAIモード(udm=50)。gemini.google.com はURLで質問文を渡せない
          ため、同じGeminiが答えるAIモードに質問文を渡す(lib/askAi.ts) */}
      <a
        href={buildGeminiAskUrl(spot, spotType)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Geminiにこのスポットについて聞く"
        title="Geminiにこのスポットについて聞く"
        className="rounded p-1 text-blue-600 hover:bg-blue-50"
      >
        <GeminiIcon className="size-5" />
      </a>
    </div>
  );
}
