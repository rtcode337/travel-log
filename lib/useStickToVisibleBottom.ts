import { useEffect, type RefObject } from "react";

/**
 * 画面の下に固定した帯を、**いま見えている範囲の下端**に置き直す。
 *
 * `fixed bottom-0` だけでは足りない。iPhoneは見えている範囲(visual viewport)と
 * fixedの基準の枠(layout viewport)を別々に持ち、ホーム画面から開いた状態では、
 * **キーボードを閉じたあと枠の位置と高さが古いまましばらく残る**(WebKitの不具合)。
 * その間、帯は枠の下に付いたまま取り残され、下へスクロールするとキーボードの
 * 高さぶんまで画面の途中へ浮き、上へ戻すと下へ戻る(実際に起きた)。
 * 見えている範囲が枠のどこにあるか(`visualViewport.offsetTop`/`height`)は
 * ずれている間も正しいので、**枠の上端から測って見えている範囲の下端へ置く**。
 *
 * - **ホーム画面から開いたときだけ**掛ける。ブラウザで開いているときは、
 *   ブラウザの帯が伸び縮みするたびに置き直すことになり、かえって揺れる
 * - **入力している間は帯を隠す**。見えている範囲はキーボードのぶん縮むので、
 *   置き直すと帯がキーボードの上に乗って書く場所を狭める
 * - **キーボードが外から閉じられたときも置き直す**。アプリの切り替え・通知・画面の
 *   ロックなどで閉じると、`resize`もフォーカスの出入りも来ないことがあり、帯が
 *   キーボードの出ていた高さに置かれたまま画面の途中に残る(実際に起きた)。
 *   画面に戻ったとき(`visibilitychange`・`pageshow`・`focus`)と、指が触れたとき
 *   にも置き直す。**閉じる動きの途中の値で置くこともある**ので、合図のたびに
 *   少し間を置いてもう数回置き直す(`settle`)
 */
export function useStickToVisibleBottom(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!active || !el || !vv || !standalone) return;

    el.style.top = "0";
    el.style.bottom = "auto";
    const typing = () => {
      const a = document.activeElement as HTMLElement | null;
      const tag = a?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!a?.isContentEditable;
    };
    const place = () => {
      el.style.visibility = typing() ? "hidden" : "";
      const y = vv.offsetTop + vv.height - el.offsetHeight;
      el.style.transform = `translateY(${Math.round(y)}px)`;
    };
    // 合図の直後は、キーボードが閉じる動きの途中の値やフォーカスが外れる前の値が
    // 残っていることがあるので、少し間を置いて置き直す(落ち着いた値で上書きする)
    const timers: number[] = [];
    const settle = () => {
      place();
      for (const t of timers.splice(0)) window.clearTimeout(t);
      for (const ms of [0, 150, 400, 800]) timers.push(window.setTimeout(place, ms));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") settle();
    };

    vv.addEventListener("resize", settle);
    vv.addEventListener("scroll", place);
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", settle);
    window.addEventListener("focus", settle);
    window.addEventListener("pageshow", settle);
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("touchstart", place, { passive: true });
    document.addEventListener("focusin", settle);
    document.addEventListener("focusout", settle);
    place();
    return () => {
      for (const t of timers) window.clearTimeout(t);
      vv.removeEventListener("resize", settle);
      vv.removeEventListener("scroll", place);
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", settle);
      window.removeEventListener("focus", settle);
      window.removeEventListener("pageshow", settle);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("touchstart", place);
      document.removeEventListener("focusin", settle);
      document.removeEventListener("focusout", settle);
      el.style.top = el.style.bottom = el.style.transform = el.style.visibility = "";
    };
  }, [ref, active]);
}
