"use client";

import { formatAvailableMonths, isAvailableNow } from "@/lib/availableMonths";
import {
  describeOpeningHours,
  OPENING_STATE_LABELS,
  openingStateAt,
} from "@/lib/openingHours";
import { useNow } from "@/lib/useNow";
import type { Spot } from "@/lib/types";

const BADGE = "rounded px-1.5 py-0.5 text-xs font-medium";

/**
 * スポット詳細の「提供の時期」と「営業時間」と、今(JST)の状態。
 * どちらも値が無ければ出さない(不明を毎回並べても読む手間が増えるだけ)。
 * 開いている間も1分ごとに測り直す(営業時間の境目をまたいでも古い答えのまま残らないように)。
 */
export default function SpotPeriodInfo({
  spot,
}: {
  spot: Pick<Spot, "available_months" | "opening_hours">;
}) {
  const months = formatAvailableMonths(spot.available_months);
  const hours = describeOpeningHours(spot.opening_hours);
  const now = useNow(!!months || !!hours);
  if (!months && !hours) return null;

  const inSeason = isAvailableNow(spot.available_months, now);
  const state = openingStateAt(spot.opening_hours, now);

  return (
    <div className="mb-3 rounded-lg bg-gray-50 p-2 text-sm text-gray-700">
      <dl className="space-y-1.5">
      {months && (
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="shrink-0 text-xs font-medium text-gray-500">提供の時期</dt>
          <dd>
            {months}
            {months !== "通年" && (
              <span
                className={`${BADGE} ml-2 ${
                  inSeason ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"
                }`}
              >
                {inSeason ? "今が時期" : "今は時期外"}
              </span>
            )}
          </dd>
        </div>
      )}
      {hours && (
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="shrink-0 text-xs font-medium text-gray-500">営業時間</dt>
          <dd className="min-w-0">
            <span
              className={`${BADGE} ${
                state === "open"
                  ? "bg-green-100 text-green-700"
                  : state === "closed"
                    ? "bg-gray-200 text-gray-600"
                    : "bg-amber-100 text-amber-700"
              }`}
            >
              {OPENING_STATE_LABELS[state]}
            </span>
            <ul className="mt-1 space-y-0.5">
              {hours.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            {hours.unreadable && (
              <p className="mt-1 text-xs text-gray-500">
                月や学校の休みの指定など読めない書き方を含むため、営業中かどうかは判断していません(書いてあるままを出しています)。
              </p>
            )}
          </dd>
        </div>
      )}
      </dl>
      <p className="mt-1.5 text-xs text-gray-400">今の状態は日本時間で判定しています。</p>
    </div>
  );
}
