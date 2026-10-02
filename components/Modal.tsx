"use client";

import { useCallback, useEffect, useRef, type ReactNode, type Ref } from "react";

/**
 * モーダルの共通の器。**画面ごとに`fixed inset-0`の重ねを手で書かない** ——
 * 書くたびに、Escで閉じる・フォーカスを中へ移す・閉じたら戻す・支援技術に
 * 「ダイアログ」と伝える、のどれかが抜ける。
 *
 * - **背景は別の`<button>`で、本体の後ろに敷く**(押すと閉じる)。かつては背景の`div`に
 *   `onClick`を付け、本体で`stopPropagation`していたが、クリックできる`div`はキーボードからも
 *   支援技術からも触れない。背景と本体が兄弟なので、本体のクリックが背景に届くことも無い
 * - **Escで閉じるのはいちばん上のモーダルだけ**(入れ子で開いたとき、下のまで一度に閉じない)
 * - **開いたらフォーカスを本体へ移し、閉じたら開く前の要素へ戻す**。中の入力欄が
 *   自分でフォーカスを取ったとき(`initialFocusRef`)はそれを優先する
 */

// 開いているモーダルの並び(後ろほど上)。Escを受けるのは末尾だけ
const openStack: symbol[] = [];

/**
 * 重なりの一番上にいるときだけEscで閉じる。モーダルの器を使わない全画面の表示
 * (写真の拡大表示など)もこれに乗せる —— 各自でEscを拾うと、下のモーダルまで一緒に閉じる。
 * 返す関数は「いま一番上か」(左右キーなど、ほかのキー操作の出し分けに使う)
 */
export function useModalLayer(onClose: () => void): () => boolean {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const idRef = useRef<symbol | null>(null);
  useEffect(() => {
    const id = Symbol("modal");
    idRef.current = id;
    openStack.push(id);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || openStack[openStack.length - 1] !== id) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      openStack.splice(openStack.indexOf(id), 1);
    };
  }, []);
  return useCallback(() => openStack[openStack.length - 1] === idRef.current, []);
}

export default function Modal({
  onClose,
  children,
  panelClassName = "",
  zIndexClassName = "z-50",
  containerClassName = "items-center",
  panelRef,
  initialFocusRef,
  label,
}: {
  onClose: () => void;
  children: ReactNode;
  /** 本体の見た目(幅・余白・角丸・スクロールなど) */
  panelClassName?: string;
  /** 重なり順。モーダルの上に開くものは`z-[60]` */
  zIndexClassName?: string;
  /** 本体の縦位置(既定は中央。狭い画面で下に寄せるときは`items-end sm:items-center`) */
  containerClassName?: string;
  panelRef?: Ref<HTMLDivElement>;
  /** 開いたときにフォーカスを渡す要素(入力欄など)。無ければ本体 */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** 支援技術に読ませる名前(見出しが無いときなど) */
  label?: string;
}) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  useModalLayer(onClose);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // 中の要素が既にフォーカスを持っていればそのまま(取り上げない)
    if (!ownRef.current?.contains(document.activeElement)) {
      (initialFocusRef?.current ?? ownRef.current)?.focus();
    }
    return () => {
      // 閉じたら開く前の場所へ戻す(消えた要素なら何もしない)
      if (previous?.isConnected) previous.focus();
    };
  }, [initialFocusRef]);

  return (
    <div className={`fixed inset-0 ${zIndexClassName} flex justify-center p-4 ${containerClassName}`}>
      <button
        type="button"
        tabIndex={-1}
        aria-label="閉じる"
        className="absolute inset-0 cursor-default bg-black/40"
        onClick={onClose}
      />
      <div
        ref={(el) => {
          ownRef.current = el;
          if (typeof panelRef === "function") panelRef(el);
          else if (panelRef) (panelRef as React.RefObject<HTMLDivElement | null>).current = el;
        }}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`relative outline-none ${panelClassName}`}
      >
        {children}
      </div>
    </div>
  );
}
