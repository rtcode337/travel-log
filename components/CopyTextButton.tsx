"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";

/**
 * テキストをクリップボードへ写すアイコンボタン。押すと数秒だけ✓に変わり、
 * 隣に結果を出す(押しただけでは何も起きていないように見えるため)。
 * 失敗することがある(非セキュアコンテキスト+古いブラウザ)ので、
 * **成功の表示は実際に写せたときだけ**出す。
 *
 * **見出しの文字列の直後に置ける**ように、全体をinlineの`span`にして
 * 上端ぞろえ(`align-top`)で描く —— スポット名の最後の文字のすぐ右上に
 * 出したいため。見出しの中に入るので、結果の文字は太字・大きさを継がないよう
 * `font-normal`/`text-xs`を自分で指定し、折り返さない(`whitespace-nowrap`)。
 */
export default function CopyTextButton({
  text,
  label,
  className = "",
}: {
  text: string;
  /** スクリーンリーダー向けの説明(例: 「スポット名をコピー」) */
  label: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 閉じたあとにsetStateが走らないよう後片付けする
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const handleClick = async () => {
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState("idle"), 2000);
  };

  return (
    <span className={`inline-flex items-center gap-1 align-top ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        aria-label={label}
        title={label}
        className="rounded p-1 text-gray-400 hover:bg-gray-50 hover:text-blue-600"
      >
        {state === "copied" ? (
          <CheckIcon className="size-4 text-green-600" />
        ) : (
          <CopyIcon className="size-4" />
        )}
      </button>
      {/* 結果は文字でも出す(色と形だけでは伝わらない)。role="status"で読み上げにも乗せる */}
      {state !== "idle" && (
        <span
          role="status"
          className={`whitespace-nowrap text-xs font-normal ${
            state === "copied" ? "text-green-600" : "text-red-600"
          }`}
        >
          {state === "copied" ? "コピーしました" : "コピーできませんでした"}
        </span>
      )}
    </span>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 12.5 9.5 18 20 6.5" />
    </svg>
  );
}
