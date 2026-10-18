"use client";

import { useEffect, useState } from "react";

/**
 * 「今手に入る」「今営業中」の判定に使う今の時刻(ミリ秒)。**`active`の間だけ1分ごとに進める**
 * (開いたままにしていると営業時間の境目を過ぎても答えが変わらないため)。
 * 使っていないときは進めない —— 地図はこの値が変わるたびにピンを描き直すので、
 * 絞り込みに関係ない間まで毎分描き直させない。画面が表に戻ったときも測り直す
 * (PWAを切り替えて戻ったときは再読み込みされないため)。
 */
export function useNow(active: boolean, intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, intervalMs]);
  return now;
}
