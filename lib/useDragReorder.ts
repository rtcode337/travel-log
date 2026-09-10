"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/** 配列の要素を from→to へ移動した新しい配列を返す */
export function move<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * 並び替えハンドルに必ず要るクラス。`touch-action: none`が無いと、タッチでは
 * ドラッグではなく一覧のスクロールになってしまう(ハンドルにだけ当てること ——
 * 行全体に当てると一覧そのものがタッチスクロールできなくなる)。
 */
export const REORDER_HANDLE_CLASS = "shrink-0 touch-none cursor-grab text-gray-400";

/**
 * 一覧の行をつかんで並び替えるための共通処理(訪問予定リストの作成パネル・
 * リスト詳細・地図の経路詳細で共用)。タッチでも動くようポインタイベントの
 * 自前実装にしてある(ライブラリ非依存)。
 *
 * - `onReorder`はドラッグ中に何度も呼ばれる(画面の並びを追従させるため)
 * - `onCommit`は指を離したときに一度だけ、順番が変わっていたときに呼ばれる
 *   (保存のように外へ出る処理はこちらへ置く。ドラッグのたびに保存しないため)
 * - `scrollRef`にスクロールする器を渡すと、端まで運んだときに自動でスクロールする
 *   (器は呼び出し側で作る —— 要素の型が一覧・モーダルで違うため)
 */
export function useDragReorder<T>({
  items,
  onReorder,
  onCommit,
  scrollRef,
}: {
  items: T[];
  onReorder: (next: T[]) => void;
  onCommit?: (next: T[]) => void;
  scrollRef?: RefObject<HTMLElement | null>;
}) {
  const rowRefs = useRef<(HTMLElement | null)[]>([]);
  const dragFrom = useRef<number | null>(null);
  /** ドラッグ中だけwindowに張る後始末(下記`handlePointerDown`の注記) */
  const detach = useRef<(() => void) | null>(null);
  /**
   * ドラッグ中の作業用の並び。**`items`(propsの値)を毎回の入れ替えの元にしない。**
   *
   * `onReorder`で外へ渡した並びが`items`として返ってくるのは、Reactが描き直したあと。
   * 指を速く動かすと**描き直しの前に次の`pointermove`が来る**ので、propsの`items`は
   * まだ1つ前(あるいはドラッグ開始時)のままで、そこから`move`すると**直前の
   * 入れ替えが無かったことになる**。1行ずつ運んだつもりが1回ぶんしか動かない、
   * 速く動かすほど結果がおかしくなる、という形で出る。
   * ここに持てば描き直しの速さに左右されない。
   */
  const working = useRef<T[] | null>(null);
  // ドラッグ中の最新の並び。指を離したときに onCommit へ渡す(順番が変わって
  // いないときは呼ばない —— つかんで離しただけで保存が走らないように)
  const latest = useRef<T[] | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const handlePointerDown = (e: React.PointerEvent, i: number) => {
    dragFrom.current = i;
    latest.current = null;
    working.current = items;
    // 消えた行の古い参照が残っていると、当たり判定が実体の無い矩形を見てしまう
    rowRefs.current.length = items.length;
    setDragIndex(i);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // 未対応環境では無視(下のwindow側の受けがあるので、これが無くても動く)
    }
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(10);
    }
    // **移動と終了はハンドルではなくwindowで受ける。**
    // つかんだ要素に載せるだけでは取りこぼす —— 並べ替えると行のDOMが動くので、
    // ブラウザによってはそこでポインタの捕捉(`setPointerCapture`)が外れる。
    // 外れたあとは指の下の別の要素へイベントが行くため、**指を離しても
    // `onCommit`が呼ばれず、画面は入れ替わったまま保存だけされない**
    // (ハンドルは幅が数十pxしかないので、縦に動かすうちに指が横へずれるだけでも起きる)。
    // windowなら捕捉の有無に関わらず必ず届く(捕捉が効いていても最後はここまで上がる)。
    detach.current?.();
    const onMove = (ev: PointerEvent) => handlePointerMove(ev);
    const onUp = () => handlePointerUp();
    // 既定の動作(スクロール・テキスト選択)を止めるので受け身にしない
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    detach.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      detach.current = null;
    };
  };

  const handlePointerMove = (e: PointerEvent | React.PointerEvent) => {
    if (dragFrom.current == null) return;
    e.preventDefault();
    const y = e.clientY;
    // 器の端に近づいたら自動スクロール(長い一覧でも端まで運べるように)
    const scroller = scrollRef?.current;
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      if (y < r.top + 28) scroller.scrollTop -= 10;
      else if (y > r.bottom - 28) scroller.scrollTop += 10;
    }
    let to = dragFrom.current;
    for (let j = 0; j < rowRefs.current.length; j += 1) {
      const el = rowRefs.current[j];
      if (!el) continue;
      const rr = el.getBoundingClientRect();
      if (y <= rr.bottom) {
        to = j;
        break;
      }
      to = j;
    }
    if (to !== dragFrom.current) {
      const next = move(working.current ?? items, dragFrom.current, to);
      working.current = next;
      latest.current = next;
      onReorder(next);
      dragFrom.current = to;
      setDragIndex(to);
    }
  };

  const handlePointerUp = () => {
    detach.current?.();
    const next = latest.current;
    if (dragFrom.current == null) return; // 二重に呼ばれたとき(捕捉と window の両方)
    dragFrom.current = null;
    latest.current = null;
    working.current = null;
    setDragIndex(null);
    if (next) onCommit?.(next);
  };

  // 掴んだまま画面が消えたときに、windowへ張ったものを残さない
  useEffect(() => () => detach.current?.(), []);

  return {
    /** 行の要素を覚える(当たり判定に使う)。`<li ref={setRowRef(i)}>` */
    setRowRef: (i: number) => (el: HTMLElement | null) => {
      rowRefs.current[i] = el;
    },
    /** ドラッグ中の行(掴んでいる位置)。無ければnull */
    dragIndex,
    /**
     * 並び替えハンドルに広げる属性。
     * `<span {...handleProps(i)} className={REORDER_HANDLE_CLASS}>≡</span>`
     *
     * **載せるのは`onPointerDown`だけ**。移動と終了はwindowで受ける(上記の注記)
     */
    handleProps: (i: number) => ({
      role: "button",
      "aria-label": "並び替え",
      onPointerDown: (e: React.PointerEvent) => handlePointerDown(e, i),
    }),
  };
}
