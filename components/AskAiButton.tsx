"use client";

import { useEffect, useRef, useState } from "react";
import { ASK_AI_TARGETS } from "@/lib/askAi";
import type { Spot, SpotType } from "@/lib/types";

/**
 * 「AIに聞く」のアイコン。特定のサービスのロゴではなく、**AI一般を表す印**にしてある
 * —— 押した先で相手を選ぶ形なので、どれか1つのブランドを出すと誤解を招く。
 */
function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2.5l1.6 4.3 4.3 1.6-4.3 1.6L12 14.3l-1.6-4.3L6.1 8.4l4.3-1.6L12 2.5z" />
      <path d="M18.5 14l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4z" />
      <path d="M5.5 13l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1z" />
    </svg>
  );
}

/**
 * スポットについて生成AIに聞くボタン。押すと相手を選ぶメニューが開く。
 *
 * **1つのアイコンにまとめてある**のは、聞ける相手が増えてもボタン行が伸びないように
 * するため(`lib/askAi.ts`の`ASK_AI_TARGETS`に足すだけで選択肢が増える)。
 *
 * **メニューは`fixed`で描く。** このボタンはスクロールする(`overflow`で切り取る)
 * モーダルの中にあるので、`absolute`だと欠ける——`HelpTip`の`anchored`と同じ事情。
 * 位置は開いた時点の`getBoundingClientRect`で決め、スクロールとリサイズで追従させる。
 * 位置が決まるまで`invisible`にするのも同じ理由(一瞬だけ画面の左上に出るのを防ぐ)。
 */
export default function AskAiButton({
  spot,
  spotType,
  className,
}: {
  spot: Spot;
  spotType?: SpotType | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 開いている間だけ位置を追う。captureを付けるのは、途中のスクロールする箱
  // (モーダルの本文)のスクロールも拾うため
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = 200;
      // 右端からはみ出さないように寄せる
      const left = Math.min(r.left, window.innerWidth - width - 8);
      setPos({ top: r.bottom + 4, left: Math.max(8, left) });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // 外側をクリック・Escで閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setPos(null);
          setOpen((v) => !v);
        }}
        aria-label="このスポットについてAIに聞く"
        title="このスポットについてAIに聞く"
        aria-haspopup="menu"
        aria-expanded={open}
        className={className ?? "rounded p-1 text-blue-600 hover:bg-blue-50"}
      >
        <SparklesIcon className="size-5" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          style={pos ? { top: pos.top, left: pos.left } : undefined}
          className={`fixed z-[70] w-[200px] rounded-xl border border-gray-200 bg-white py-1 shadow-lg ${
            pos ? "" : "invisible"
          }`}
        >
          <p className="px-3 pb-1 pt-1 text-xs text-gray-400">AIに聞く</p>
          {ASK_AI_TARGETS.map((t) => (
            <a
              key={t.id}
              role="menuitem"
              href={t.buildUrl(spot, spotType)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-gray-700 hover:bg-blue-50"
            >
              {t.label}
              <span className="ml-1 text-xs text-gray-400">{t.note}</span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
