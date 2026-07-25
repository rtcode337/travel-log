"use client";

import { useState, type ReactNode } from "react";

/**
 * 見出しの横に置く「?」ボタン。押すと説明文を吹き出し(チップ)で表示する。
 * 各セクションの長い説明書きを畳んで見出しをすっきりさせるためのもの。
 * 開いている間は画面全体に透明な当たり判定を敷き、外側タップで閉じる。
 */
export default function HelpTip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label="説明を表示"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] font-bold leading-none text-gray-500 hover:bg-gray-50"
      >
        ?
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="説明を閉じる"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <span className="absolute left-0 top-full z-20 mt-1 block w-72 max-w-[80vw] rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-normal leading-relaxed text-gray-600 shadow-lg">
            {children}
          </span>
        </>
      )}
    </span>
  );
}
