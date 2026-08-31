"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import {
  diffDays,
  formatWeatherDateWithDay,
  outlookScore,
  shiftDate,
  summarizeDay,
  weatherLook,
  type DailyWeather,
  type DayOutlook,
} from "@/lib/weather";
import HelpTip from "@/components/HelpTip";

/** 予定日の前後に何日ぶん見るか */
const WINDOW_DAYS = 7;

/**
 * 訪問予定日の前後で、天気の良い日を探す。
 *
 * **予定を立てたあとに雨予報になることがある**ので、そのときに「近い日でずらせるか」を
 * 同じ画面で確かめられるようにする。**旅程に並ぶ全スポットの予報をまとめて見て**、
 * 1日ぶんを1行にたたむ —— 1か所でも降れば雨具が要るので、いちばん悪い地点に合わせる
 * (`summarizeDay`)。
 *
 * **予報が無い日を空欄にしない。** 予報が出るのは先15日ほどまでなので、
 * 遠い予定では前後1週間のほとんどが範囲外になる。そこを黙って飛ばすと
 * 「候補が無い=悪い日」と読めてしまうため、「予報なし」と書いて数からも外す。
 *
 * 日付を選ぶと、**旅程の長さを保ったまま**開始日・終了日をずらす
 * (3日間の旅程なら3日間のまま動く)。
 */
export default function PlanWeatherFinder({
  points,
  date,
  endDate,
  onPick,
  saving,
}: {
  /** 旅程に並ぶスポットの座標(予報を引く対象) */
  points: { lat: number; lng: number }[];
  /** いまの予定日(この日を中心に前後を見る) */
  date: string;
  /** いまの終了日。旅程の長さを保ってずらすのに使う */
  endDate: string;
  /** 日を選んだとき。ずらした開始日と終了日を渡す */
  onPick: (start: string, end: string) => void;
  /** 保存中(ボタンを押せなくする) */
  saving?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState<DayOutlook[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = shiftDate(date, -WINDOW_DAYS);
  const end = shiftDate(date, WINDOW_DAYS);
  // 依存に配列そのものを置くと描画のたびに引き直すので、座標から鍵を作る
  const pointsKey = points
    .map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`)
    .join(";");

  const load = useCallback(async () => {
    if (!pointsKey) return;
    setLoading(true);
    setError(null);
    const { data, error } = await api.weather.range(
      pointsKey.split(";").map((s) => {
        const [lat, lng] = s.split(",").map(Number);
        return { lat, lng };
      }),
      start,
      end
    );
    setLoading(false);
    if (error || !data) {
      setError("予報を取得できませんでした。時間をおいて試してください。");
      return;
    }
    setDays(
      data.dates.map((d, j) =>
        summarizeDay(
          d,
          data.byPoint.map((row) => row[j])
        )
      )
    );
  }, [pointsKey, start, end]);

  useEffect(() => {
    if (open && !days && !loading) void load();
  }, [open, days, loading, load]);

  // 予定日が変われば見る範囲も変わるので、取り直させる
  useEffect(() => {
    setDays(null);
  }, [date, pointsKey]);

  if (points.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-300 py-2 text-sm text-gray-600"
      >
        🔆 前後1週間で天気の良い日を探す
      </button>
    );
  }

  // 予報のある日だけを候補にして、いちばん良い日を印で示す
  const known = (days ?? []).filter((d) => d.known > 0);
  const best = known.length
    ? known.reduce((a, b) => (outlookScore(b) > outlookScore(a) ? b : a))
    : null;
  // 旅程の長さ(日数)。選んだ日にこれを足して終了日をずらす
  const length = diffDays(date, endDate);

  return (
    <div className="mt-3 rounded-xl border border-gray-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          前後1週間の天気
          <HelpTip>
            旅程に入っているスポット全部の予報をまとめて、1日ずつ並べています。
            <b>いちばん天気の悪いスポットに合わせて</b>表示するので、
            どこか1か所でも雨なら雨として出ます。日付を選ぶと、
            旅程の長さを保ったまま予定日をずらします。
            予報の出どころはOpen-Meteo(CC BY 4.0)です。
          </HelpTip>
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="shrink-0 text-xs text-gray-400 hover:text-gray-600"
        >
          閉じる
        </button>
      </div>

      {loading && <p className="text-sm text-gray-500">予報を読み込み中…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {days && (
        <>
          <ul className="divide-y divide-gray-100">
            {days.map((day) => {
              const isPlanned = day.date === date;
              const isBest = best != null && day.date === best.date && !isPlanned;
              return (
                <li
                  key={day.date}
                  className={`flex items-center gap-2 py-1.5 ${
                    isPlanned ? "bg-blue-50" : ""
                  }`}
                >
                  <span className="w-20 shrink-0 text-xs tabular-nums text-gray-600">
                    {formatWeatherDateWithDay(day.date)}
                  </span>
                  {day.known === 0 ? (
                    <span className="flex-1 text-xs text-gray-400">
                      予報なし
                    </span>
                  ) : (
                    <>
                      <span aria-hidden="true" className="shrink-0 text-base leading-none">
                        {weatherLook((day.worst as DailyWeather).code).icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-gray-600">
                        {weatherLook((day.worst as DailyWeather).code).text}
                        {day.pop != null && ` 降水${day.pop}%`}
                        {day.tmax != null && ` ${Math.round(day.tmax)}℃`}
                        {day.known > 1 && (
                          <span className="text-gray-400">
                            {" "}
                            (晴れ {day.good}/{day.known})
                          </span>
                        )}
                      </span>
                    </>
                  )}
                  {isBest && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                      おすすめ
                    </span>
                  )}
                  {isPlanned ? (
                    <span className="shrink-0 text-[10px] font-medium text-blue-600">
                      予定日
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={saving || day.known === 0}
                      onClick={() => onPick(day.date, shiftDate(day.date, length))}
                      className="shrink-0 rounded-full border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600 disabled:opacity-30"
                    >
                      この日にする
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {known.length === 0 && (
            <p className="mt-2 text-xs text-gray-500">
              この期間の予報はまだ出ていません(予報が出るのは15日ほど先まで)。
              日が近づいてから、もう一度見てください。
            </p>
          )}
          <p className="mt-2 text-[11px] text-gray-400">
            予報: Open-Meteo(CC BY 4.0)
          </p>
        </>
      )}
    </div>
  );
}
