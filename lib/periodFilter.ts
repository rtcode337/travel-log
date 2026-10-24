import { isAvailableNow } from "./availableMonths";
import { openingStateAt } from "./openingHours";

/**
 * 「今手に入る」「今営業中」で外れたスポットをどう見せるか。
 * `"dim"`=灰色で残す(既定)、`"hide"`=地図・一覧から隠す。
 * **既定を灰色にしてあるのは**、隠すと「時期外・営業時間外のもの」があることすら
 * 地図から読めなくなるため(近くに行けば手に入る・開く、の当たりが付けられない)。
 */
export type OutOfTimeMode = "dim" | "hide";

/** 判定に要る絞り込みの値(`SpotFilters`の一部) */
export interface PeriodFilterValues {
  availableNow: boolean;
  openNow: boolean;
}

/** 判定に要るスポットの値 */
export interface PeriodValues {
  available_months?: string | null;
  opening_hours?: string | null;
}

/**
 * 「今手に入る」「今営業中」の絞り込みから外れるか(時期外・営業時間外)。
 * 絞り込みを点けていなければ外れない。「今」は`now`で、判定はJST。
 *
 * - 今手に入る: 提供の時期に今の月が入らない(時期が空=通年か不明は入る側)
 * - 今営業中: 営業時間外と、営業時間が不明(空・読めない書き方)。今入れると読めるものだけ残す
 */
export function isOutOfTime(
  filters: PeriodFilterValues,
  period: PeriodValues | null,
  now: number = Date.now()
): boolean {
  if (filters.availableNow && !isAvailableNow(period?.available_months, now)) {
    return true;
  }
  if (filters.openNow) {
    const state = openingStateAt(period?.opening_hours, now);
    if (state === "closed" || state === "unknown") return true;
  }
  return false;
}

/**
 * 営業時間が不明(空・読めない書き方)か。「営業時間不明だけ」の絞り込みに使う
 * (`components/FilterBar.tsx`の`passesFilters`)。祝日の指定は日付で読めたり読めなかったり
 * するので、判定は`now`の日で行う(「今営業中」と同じ`openingStateAt`)。
 */
export function isHoursUnknown(period: PeriodValues | null, now: number = Date.now()): boolean {
  return openingStateAt(period?.opening_hours, now) === "unknown";
}
