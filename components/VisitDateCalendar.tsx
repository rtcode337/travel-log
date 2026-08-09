"use client";

import { useMemo, useState } from "react";

/** `YYYY-MM-DD`のローカル日付キーを作る */
function dateKey(year: number, month: number, day: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(month + 1)}-${p(day)}`;
}

/** `YYYY-MM-DD`から年・月(0始まり)を取り出す。不正値はnull */
function parseKey(key: string | null): { year: number; month: number } | null {
  if (!key) return null;
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(key);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1 };
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 訪問順の経路の対象日を選ぶカレンダー。**単日でも期間でも選べる**。
 *
 * - **訪問記録のある日が一目で分かる**(日付の下に点を打つ)。どの日に何か記録が
 *   あるか分からないまま総当たりで選ぶことになるのを避けるためで、
 *   点の無い日を選んでも構わない(経路が0件になるだけ)
 * - 選択は「1回目のタップで開始日、2回目で終了日」。既に期間が決まっている状態で
 *   タップすると新しい開始日として選び直す(範囲を狭めるのに毎回リセットを
 *   挟まずに済む)。開始日より前をタップしたときは、その日を開始日にして
 *   元の開始日を終了日にする(前方向にも伸ばせる)
 * - 月の移動は見出しの `‹` `›`。**JSは選択と月移動だけ**で、描画は素のグリッド
 *
 * 日付キーはすべて`YYYY-MM-DD`のローカル日付(`toVisitDateKey`と同じ表現)なので、
 * 大小比較・期間判定は文字列のままできる。
 */
export default function VisitDateCalendar({
  from,
  to,
  markedDates,
  today,
  onSelect,
}: {
  /** 選択中の開始日(`YYYY-MM-DD`)。null=未選択 */
  from: string | null;
  /** 選択中の終了日。null=単日(fromのみ) */
  to: string | null;
  /** 訪問記録のある日(点を打つ) */
  markedDates: Set<string>;
  /** 今日の日付キー(枠で示す) */
  today: string;
  /** 選択が変わったとき。単日なら to は null */
  onSelect: (from: string, to: string | null) => void;
}) {
  // 表示中の月。選択中の日(なければ今日)の月から始める
  const initial = parseKey(from) ?? parseKey(today)!;
  const [view, setView] = useState(initial);

  /** 表示中の月のマス目。前月・翌月ぶんの空きマスはnullで埋める */
  const cells = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const lead = first.getDay();
    const list: (number | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) list.push(d);
    // 最終行の余りも埋めて、行ごとの高さをそろえる
    while (list.length % 7 !== 0) list.push(null);
    return list;
  }, [view]);

  const shiftMonth = (delta: number) => {
    const d = new Date(view.year, view.month + delta, 1);
    setView({ year: d.getFullYear(), month: d.getMonth() });
  };

  const handleClick = (key: string) => {
    // 開始日が無い/既に期間が決まっている → 新しい開始日として選び直す
    if (!from || to) {
      onSelect(key, null);
      return;
    }
    // 開始日より前を選んだら、前方向へ伸ばす(選んだ日が開始、元の開始が終了)
    if (key < from) {
      onSelect(key, from);
      return;
    }
    // 同じ日を2回選んだら単日のまま(期間にしない)
    onSelect(from, key === from ? null : key);
  };

  const rangeEnd = to ?? from;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="前の月"
          className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
        >
          ‹
        </button>
        <span className="text-sm font-medium">
          {view.year}年{view.month + 1}月
        </span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="次の月"
          className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-gray-400">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-0.5">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const key = dateKey(view.year, view.month, day);
          const selected = from !== null && key >= from && key <= rangeEnd!;
          const isEdge = key === from || key === rangeEnd;
          const marked = markedDates.has(key);
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleClick(key)}
              aria-label={`${view.month + 1}月${day}日${marked ? "(訪問あり)" : ""}`}
              aria-pressed={selected}
              className={`relative mx-auto flex size-8 flex-col items-center justify-center rounded-full text-sm ${
                selected && isEdge
                  ? "bg-blue-600 font-medium text-white"
                  : selected
                    ? "bg-blue-100 text-blue-900"
                    : "text-gray-700 hover:bg-gray-100"
              } ${key === today && !selected ? "ring-1 ring-blue-400" : ""}`}
            >
              {day}
              {/* 訪問記録のある日の印。選択中は白、それ以外は緑(訪問順の経路と同色) */}
              {marked && (
                <span
                  className={`absolute bottom-1 size-1 rounded-full ${
                    selected && isEdge ? "bg-white" : "bg-green-600"
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
