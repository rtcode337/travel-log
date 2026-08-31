"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** 拡大率の下限・上限。1=画面に収まる大きさ */
const MIN_SCALE = 1;
const MAX_SCALE = 6;
/** ダブルタップで飛ぶ拡大率 */
const DOUBLE_TAP_SCALE = 2.5;
/** タップと判定する移動量(px)。これを超えたらスワイプ・パン扱い */
const TAP_SLOP = 8;
/** ダブルタップと判定する間隔(ms) */
const DOUBLE_TAP_MS = 300;
/** 写真を切り替えるスワイプ量。画面幅に対する割合 */
const SWIPE_RATIO = 0.22;

interface Transform {
  scale: number;
  x: number;
  y: number;
}

const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };

/**
 * 写真の拡大表示(ライトボックス)。**ピンチで拡大縮小、スワイプで前後の写真へ。**
 *
 * アプリ全体でページのピンチズームを切ってある(`app/layout.tsx`の`userScalable: false`)
 * ため、**ブラウザ任せの拡大はできない** —— 二本指の距離を自分で見て拡大率を持つ。
 * 同じ理由でホイールは`ctrl`付き(トラックパッドのピンチ)だけを拡大に使う。
 *
 * 操作は指1本か2本かで分ける。
 *
 * - **2本** —— ピンチで拡大縮小。**2本の中点を軸にする**ので、見たい場所を
 *   つまんで広げればそこが寄る(画面中央固定だと端を見るのにパンし直すことになる)
 * - **1本・等倍** —— 横スワイプで前後の写真へ。指の動きに合わせて紙芝居ごと動かし、
 *   画面幅の2割ほど動かして離すと切り替わる(足りなければ元に戻る)
 * - **1本・拡大中** —— パン(表示位置の移動)。**この状態では左右スワイプを
 *   写真の切り替えに使わない** —— 拡大して端を見に行く操作と区別が付かないため
 * - **ダブルタップ** —— 等倍と2.5倍を行き来する。触れた場所を軸にする
 * - **1本でタップ** —— 閉じる(等倍のときだけ)。拡大中は誤って閉じやすいので、
 *   閉じるのは右上の×とEscに限る
 *
 * 写真をまたぐと拡大は解ける。前の写真の拡大率のまま次に移ると、
 * 「なぜか一部しか見えない」状態で始まることになるため。
 */
export default function PhotoLightbox({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  /** 同じ訪問記録の写真(表示順)。1枚でも動く */
  photos: string[];
  /** いま見ている写真の位置 */
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  // 拡大率と表示位置。写真を移ると等倍に戻す
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  // スワイプ中の横方向のずれ(px)。指を離すと0に戻る
  const [dragX, setDragX] = useState(0);
  // 指を離した後だけアニメーションさせる(ドラッグ中に付けると指に遅れて付いてくる)
  const [animating, setAnimating] = useState(false);

  const zoomed = transform.scale > 1.01;

  /** 押されている指。ポインタIDごとに最後の位置を持つ */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** ピンチの開始時の状態(2本目が触れた時点で決める) */
  const pinchStart = useRef<{
    distance: number;
    center: { x: number; y: number };
    transform: Transform;
  } | null>(null);
  /** 1本指の操作の開始位置と、タップ判定用の移動量 */
  const dragStart = useRef<{
    x: number;
    y: number;
    transform: Transform;
    moved: number;
  } | null>(null);
  const lastTapAt = useRef(0);

  useEffect(() => {
    setTransform(IDENTITY);
    setDragX(0);
  }, [index]);

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0 || next >= photos.length) return;
      onIndexChange(next);
    },
    [index, photos.length, onIndexChange]
  );

  // Escで閉じ、左右キーで前後の写真へ(ポインタの無い環境でも一通り操作できる)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, go]);

  /**
   * 表示中の写真が画面に占めている矩形(`object-contain`なので要素の箱より小さい)。
   * パンの行きすぎを止めるのに使う。読めないうちは要素の箱で代用する。
   */
  const imageBox = useCallback(() => {
    const el = imageRef.current;
    if (!el) return { width: 0, height: 0 };
    const boxW = el.clientWidth;
    const boxH = el.clientHeight;
    const nw = el.naturalWidth;
    const nh = el.naturalHeight;
    if (!nw || !nh) return { width: boxW, height: boxH };
    const scale = Math.min(boxW / nw, boxH / nh);
    return { width: nw * scale, height: nh * scale };
  }, []);

  /** 拡大したぶんはみ出した範囲までに移動を抑える(端より外を見せない) */
  const clamp = useCallback(
    (t: Transform): Transform => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale));
      const { width, height } = imageBox();
      const maxX = Math.max(0, (width * scale - width) / 2);
      const maxY = Math.max(0, (height * scale - height) / 2);
      return {
        scale,
        x: Math.min(maxX, Math.max(-maxX, t.x)),
        y: Math.min(maxY, Math.max(-maxY, t.y)),
      };
    },
    [imageBox]
  );

  /** 指定した画面座標を軸に拡大率を変える */
  const zoomAt = useCallback(
    (nextScale: number, clientX: number, clientY: number, base: Transform) => {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // 軸の位置を「中心からのずれ」で持つ。拡大率の比だけ位置も伸びる
      const cx = clientX - rect.left - rect.width / 2;
      const cy = clientY - rect.top - rect.height / 2;
      const ratio = nextScale / base.scale;
      setTransform(
        clamp({
          scale: nextScale,
          x: cx - (cx - base.x) * ratio,
          y: cy - (cy - base.y) * ratio,
        })
      );
    },
    [clamp]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setAnimating(false);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        transform,
      };
      // 2本目が触れたらスワイプは取り消す(ピンチの途中で写真が変わらないように)
      dragStart.current = null;
      setDragX(0);
    } else if (pointers.current.size === 1) {
      dragStart.current = { x: e.clientX, y: e.clientY, transform, moved: 0 };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const start = pinchStart.current;
      const next = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, (start.transform.scale * distance) / start.distance)
      );
      zoomAt(next, start.center.x, start.center.y, start.transform);
      return;
    }

    const start = dragStart.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start.moved = Math.max(start.moved, Math.hypot(dx, dy));
    if (start.transform.scale > 1.01) {
      setTransform(
        clamp({
          scale: start.transform.scale,
          x: start.transform.x + dx,
          y: start.transform.y + dy,
        })
      );
    } else if (Math.abs(dx) > Math.abs(dy)) {
      // 等倍のときだけ横スワイプ。端の写真では引きが重くなるようにして
      // 「これ以上ない」ことを手応えで伝える
      const atEdge =
        (dx > 0 && index === 0) || (dx < 0 && index === photos.length - 1);
      setDragX(atEdge ? dx / 3 : dx);
    }
  };

  const settle = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size >= 2) return;
    pinchStart.current = null;
    if (pointers.current.size === 1) {
      // 2本のうち1本だけ離した。残りの指で操作を続けられるように取り直す
      const [rest] = [...pointers.current.values()];
      dragStart.current = { x: rest.x, y: rest.y, transform, moved: TAP_SLOP + 1 };
      return;
    }

    const start = dragStart.current;
    dragStart.current = null;
    setAnimating(true);

    // 等倍でのスワイプ。十分動かしていれば前後の写真へ
    const width = viewportRef.current?.clientWidth ?? 1;
    if (dragX !== 0) {
      const threshold = width * SWIPE_RATIO;
      if (dragX <= -threshold) go(1);
      else if (dragX >= threshold) go(-1);
      setDragX(0);
      return;
    }

    if (!start || start.moved > TAP_SLOP) {
      // 拡大率が1を下回るところまで縮めていたら等倍へ戻す
      if (transform.scale <= MIN_SCALE + 0.01) setTransform(IDENTITY);
      return;
    }

    // ここから先はタップ。連続していればダブルタップとして拡大する
    const now = Date.now();
    if (now - lastTapAt.current < DOUBLE_TAP_MS) {
      lastTapAt.current = 0;
      if (zoomed) setTransform(IDENTITY);
      else zoomAt(DOUBLE_TAP_SCALE, e.clientX, e.clientY, IDENTITY);
      return;
    }
    lastTapAt.current = now;
    // 拡大中のタップでは閉じない(パンの途中で閉じてしまうため)。×とEscで閉じる
    if (!zoomed) {
      // ダブルタップの1回目かもしれないので、判定の間だけ待ってから閉じる
      const at = now;
      window.setTimeout(() => {
        if (lastTapAt.current === at) onClose();
      }, DOUBLE_TAP_MS);
    }
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinchStart.current = null;
    dragStart.current = null;
    setDragX(0);
  };

  /** トラックパッドのピンチ(ctrl+ホイール)。素のホイールはスクロールのまま */
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const next = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, transform.scale * (1 - e.deltaY / 200))
    );
    zoomAt(next, e.clientX, e.clientY, transform);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/90"
      // 親のオーバーレイ(スポット詳細を閉じる)まで伝播させない
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={settle}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
        // ブラウザ既定のスクロール・ズームに取られると自前の操作が届かない
        className="relative flex-1 touch-none overflow-hidden select-none"
      >
        {/* 全部の写真を横に並べ、いま見ているものが中央に来るよう動かす。
            1件の訪問記録に付く枚数は上限があるので、まとめて置いてよい */}
        <div
          className="flex h-full w-full"
          style={{
            transform: `translateX(calc(${-index * 100}% + ${dragX}px))`,
            transition: animating ? "transform 200ms ease-out" : undefined,
          }}
        >
          {photos.map((src, i) => (
            <div
              key={i}
              className="flex h-full w-full shrink-0 items-center justify-center p-4"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={i === index ? imageRef : undefined}
                src={src}
                alt=""
                draggable={false}
                className="max-h-full max-w-full rounded-lg object-contain"
                style={
                  i === index
                    ? {
                        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                        transition: animating ? "transform 200ms ease-out" : undefined,
                      }
                    : undefined
                }
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-xl text-white"
          aria-label="拡大表示を閉じる"
        >
          ×
        </button>
        {photos.length > 1 && (
          <p className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/50 px-2.5 py-0.5 text-xs tabular-nums text-white">
            {index + 1} / {photos.length}
          </p>
        )}
      </div>

      {/* 指が使えない環境(マウス・キーボード)でも前後に動かせるようにする。
          スワイプできることは操作の説明に書いておく */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-4 text-white">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={index === 0}
          aria-label="前の写真"
          className="rounded-full bg-black/50 px-3 py-1.5 text-sm disabled:opacity-30"
        >
          ‹ 前
        </button>
        <p className="min-w-0 truncate text-center text-[11px] text-white/60">
          {photos.length > 1 ? "スワイプで前後の写真、" : ""}
          ピンチかダブルタップで拡大
        </p>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={index === photos.length - 1}
          aria-label="次の写真"
          className="rounded-full bg-black/50 px-3 py-1.5 text-sm disabled:opacity-30"
        >
          次 ›
        </button>
      </div>
    </div>
  );
}
