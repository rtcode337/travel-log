"use client";

import { useRef, useState } from "react";
import type { Spot } from "@/lib/types";
import { type SeriesStyleDefinition } from "@/lib/seriesStyle";
import SeriesBadge from "@/components/SeriesBadge";

/** 配列の要素を from→to へ移動した新しい配列を返す */
function move<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** 長押しからドラッグに移るまでの時間(ms) */
const LONG_PRESS_MS = 280;

/**
 * 訪問予定リスト作成モードで地図の右側に出すパネル。リストのタイトルと、
 * 選択済みスポットの一覧(×ボタン以外のどこでも長押し→ドラッグで並び替え)、
 * 「入力完了」ボタンを表示する。並び替えはタッチでも動くようポインタイベントで実装し、
 * ドラッグ中は`touch-action: none`+端での自動スクロールでスクロールと両立させる。
 */
export default function PlanBuildPanel({
  title,
  editing = false,
  spotIds,
  spotsById,
  seriesStyles,
  saving,
  onReorder,
  onRemove,
  onComplete,
  onCancel,
}: {
  title: string;
  /** 既存リストの編集中なら見出し・ボタンの文言を「編集/更新」にする */
  editing?: boolean;
  spotIds: string[];
  spotsById: Map<string, Spot>;
  seriesStyles: SeriesStyleDefinition[];
  saving: boolean;
  onReorder: (spotIds: string[]) => void;
  onRemove: (spotId: string) => void;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const dragFrom = useRef<number | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startY = useRef(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const clearPress = () => {
    if (pressTimer.current != null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent, i: number) => {
    startY.current = e.clientY;
    const el = e.currentTarget as HTMLElement;
    const pid = e.pointerId;
    clearPress();
    // 長押しが確定したらドラッグ開始(タップやスクロールと区別する)
    pressTimer.current = setTimeout(() => {
      dragFrom.current = i;
      setDragIndex(i);
      try {
        el.setPointerCapture(pid);
      } catch {
        // 未対応環境では無視(マウスならcaptureなしでも動く)
      }
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(10);
      }
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragFrom.current == null) {
      // 長押し確定前に大きく動いたら「並び替えではない」と判断して長押しをやめる
      if (pressTimer.current != null && Math.abs(e.clientY - startY.current) > 8) {
        clearPress();
      }
      return;
    }
    e.preventDefault();
    const y = e.clientY;
    // リストの端に近づいたら自動スクロール(長い一覧でも端まで運べるように)
    const list = listRef.current;
    if (list) {
      const r = list.getBoundingClientRect();
      if (y < r.top + 28) list.scrollTop -= 10;
      else if (y > r.bottom - 28) list.scrollTop += 10;
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
      onReorder(move(spotIds, dragFrom.current, to));
      dragFrom.current = to;
      setDragIndex(to);
    }
  };

  const handlePointerUp = () => {
    clearPress();
    dragFrom.current = null;
    setDragIndex(null);
  };

  return (
    <div className="absolute bottom-0 right-0 top-40 z-20 flex w-2/5 max-w-sm flex-col overflow-hidden rounded-tl-xl bg-white/95 shadow-xl backdrop-blur">
      <div className="border-b border-gray-200 p-3">
        <p className="text-xs text-gray-500">
          訪問予定リストを{editing ? "編集中" : "作成中"}
        </p>
        <h2 className="break-words font-bold leading-snug">{title}</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          ピンをタップして追加({spotIds.length}件)
        </p>
      </div>

      <ul
        ref={listRef}
        className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto"
      >
        {spotIds.length === 0 && (
          <li className="p-3 text-xs text-gray-500">
            地図のピンをタップすると、ここに追加されます。長押しで並び替えできます。
          </li>
        )}
        {spotIds.map((spotId, i) => {
          const spot = spotsById.get(spotId);
          return (
            <li
              key={spotId}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              onPointerDown={(e) => handlePointerDown(e, i)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className={`flex touch-none select-none items-center gap-2 px-2.5 py-2 ${
                dragIndex === i ? "bg-blue-100" : ""
              }`}
            >
              {spot ? (
                <>
                  <SeriesBadge
                    series={spot.series}
                    seriesStyles={seriesStyles}
                    isPrivate={spot.status === "private"}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 break-words text-sm leading-snug">
                    {spot.name}
                  </span>
                </>
              ) : (
                <span className="min-w-0 flex-1 break-words text-sm text-gray-400">
                  (読み込み中のスポット)
                </span>
              )}
              <button
                type="button"
                aria-label="削除"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onRemove(spotId)}
                className="shrink-0 px-1 text-lg leading-none text-gray-400 hover:text-red-500"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 border-t border-gray-200 p-3">
        <button
          type="button"
          onClick={onComplete}
          disabled={saving || spotIds.length === 0}
          className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "保存中…" : editing ? "更新" : "入力完了"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="w-full rounded-lg border border-gray-300 py-2 text-sm text-gray-600 disabled:opacity-50"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}
