"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** `anchored`の吹き出しの幅(px)。Tailwindの`w-72`と同じ値 */
const ANCHORED_WIDTH = 288;
/** `anchored`の吹き出しを画面端から離す余白(px) */
const ANCHORED_MARGIN = 12;

/**
 * 見出しの横に置く「?」ボタン。押すと説明文を吹き出し(チップ)で表示する。
 * 各セクションの長い説明書きを畳んで見出しをすっきりさせるためのもの。
 * 開いている間は画面全体に透明な当たり判定を敷き、外側タップで閉じる。
 *
 * 既定の吹き出しは`absolute`なので、`overflow`で切り取る箱(スクロールする一覧や
 * 角丸のために`overflow-hidden`を掛けた枠)の中に置くと欠ける。そういう場所では
 * 次のどちらかを使う:
 *
 * - **`anchored`**: `position: fixed`で**「?」の真下(下半分にあるときは真上)**に出す。
 *   箱の外に描かれるので切り取られず、それでいて説明がどのボタンのものか分かる。
 *   基本はこちら
 * - **`sheet`**: 位置を問わず**画面の下端に固定して出す**。「?」が画面の端にあって
 *   真下・真上のどちらにも収まらないときや、地図の上のように吹き出しが操作の邪魔に
 *   なるときに使う
 */
export default function HelpTip({
  children,
  sheet = false,
  anchored = false,
}: {
  children: ReactNode;
  sheet?: boolean;
  anchored?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // anchoredのときの吹き出しの位置(px)。topかbottomのどちらか一方だけを使う
  const [pos, setPos] = useState<{
    left: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  useEffect(() => {
    if (!open || !anchored) return;
    const update = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(
        ANCHORED_WIDTH,
        window.innerWidth - ANCHORED_MARGIN * 2
      );
      // 「?」の左端に合わせ、画面からはみ出す分だけ内側へ寄せる
      const left = Math.min(
        Math.max(ANCHORED_MARGIN, rect.left),
        window.innerWidth - ANCHORED_MARGIN - width
      );
      // 画面の下半分にある「?」は、真下に出すと吹き出しが画面外へ落ちるため上に出す
      // (fixedなので箱には切り取られない代わり、画面外へ出ると読めなくなる)
      const above = rect.bottom > window.innerHeight * 0.55;
      setPos({
        left,
        top: above ? undefined : rect.bottom + 4,
        bottom: above ? window.innerHeight - rect.top + 4 : undefined,
      });
    };
    update();
    // スクロールする箱の中に置かれることがあるため、captureでその箱の分も拾う
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchored]);

  return (
    <span className="relative inline-flex align-middle">
      <button
        ref={buttonRef}
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
          <span
            style={
              anchored && pos
                ? {
                    left: pos.left,
                    top: pos.top,
                    bottom: pos.bottom,
                    width: ANCHORED_WIDTH,
                    maxWidth: `calc(100vw - ${ANCHORED_MARGIN * 2}px)`,
                  }
                : undefined
            }
            className={`z-20 block rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-normal leading-relaxed text-gray-600 shadow-lg ${
              anchored
                ? // 位置が決まるまでは描かない(左上に一瞬出てから飛ぶのを防ぐ)
                  `fixed ${pos ? "" : "invisible"}`
                : sheet
                  ? "fixed inset-x-3 bottom-3 mx-auto max-w-sm"
                  : "absolute left-0 top-full mt-1 w-72 max-w-[80vw]"
            }`}
          >
            {children}
          </span>
        </>
      )}
    </span>
  );
}
