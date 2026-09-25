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
    // フォーカスが外れた直後は、まだ入力欄を指していることがある
    const later = () => window.setTimeout(place, 0);

    vv.addEventListener("resize", place);
    vv.addEventListener("scroll", place);
    window.addEventListener("scroll", place, { passive: true });
    document.addEventListener("focusin", place);
    document.addEventListener("focusout", later);
    place();
    return () => {
      vv.removeEventListener("resize", place);
      vv.removeEventListener("scroll", place);
      window.removeEventListener("scroll", place);
      document.removeEventListener("focusin", place);
      document.removeEventListener("focusout", later);
      el.style.top = el.style.bottom = el.style.transform = el.style.visibility = "";
    };
  }, [ref, active]);
}
