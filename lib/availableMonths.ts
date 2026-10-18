/**
 * 提供の時期(`spots.available_months`)。そのスポット(季節限定の料理・土産など)が
 * **何月に手に入るか**を、月の範囲と列挙で書く。
 *
 * - `11-3` = 11月〜3月(**終わりが始まりより小さければ年をまたぐ**)
 * - `6,7,8` = 6・7・8月、`12-2,7` = 12月〜2月と7月(範囲と列挙を混ぜてよい)
 * - 空(null) = 通年か不明
 *
 * 保存するのは`normalizeAvailableMonths`で整えた形(空白を除き、先頭の0を落とし、
 * `3-3`は`3`にする)。DBにも同じ字面の検査(`spots_available_months_ck`)がある。
 * 判定の「今」はJST(`jstClock`)で、実行環境のTZに頼らない。
 */
import { jstClock } from "@/lib/datetime";

/** 1区切り(`11-3`・`7`)の形。月は1〜12で、先頭の0は許す(整えるときに落とす) */
const SEGMENT_RE = /^(\d{1,2})(?:-(\d{1,2}))?$/;

interface MonthSegment {
  from: number;
  to: number;
}

function parseSegments(value: string): MonthSegment[] | null {
  // 区切り(`,`・`-`)の前後の空白だけを許す(`1 1-3`を`11-3`と読まないよう、数字の間の空白は残す)
  const compact = value.trim().replace(/\s*([,-])\s*/g, "$1");
  if (compact === "") return null;
  const segments: MonthSegment[] = [];
  for (const part of compact.split(",")) {
    const m = SEGMENT_RE.exec(part);
    if (!m) return null;
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from < 1 || from > 12 || to < 1 || to > 12) return null;
    segments.push({ from, to });
  }
  return segments;
}

/**
 * CSV・フォーム・APIから来た値を検査して、保存する形に整える。
 * 空・空白だけは`null`(通年か不明)。**読めない値はエラーにする** —— 黙って空にすると
 * 「通年」として手に入る側に数えられ、時期外のものが「今手に入る」に並んでしまう。
 */
export function normalizeAvailableMonths(
  raw: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: null };
  // APIのボディから来た数値(`7`)なども文字として読む
  if (typeof raw !== "string" && typeof raw !== "number") {
    return { ok: false, error: "提供の時期は文字列で指定してください" };
  }
  const text = String(raw);
  if (text.trim() === "") return { ok: true, value: null };
  const segments = parseSegments(text);
  if (!segments) {
    return {
      ok: false,
      error: `提供の時期「${text}」は読めません(例: 11-3、6,7,8、12-2,7。月は1〜12)`,
    };
  }
  return {
    ok: true,
    value: segments
      .map((s) => (s.from === s.to ? String(s.from) : `${s.from}-${s.to}`))
      .join(","),
  };
}

/** 月(1〜12)ごとに手に入るか。読めない値はnull */
function monthTable(value: string): boolean[] | null {
  const segments = parseSegments(value);
  if (!segments) return null;
  const table = new Array<boolean>(13).fill(false);
  for (const { from, to } of segments) {
    // 終わりが始まりより小さい範囲は年をまたぐ(11-3 = 11,12,1,2,3)
    for (let m = from; ; m = (m % 12) + 1) {
      table[m] = true;
      if (m === to) break;
    }
  }
  return table;
}

/**
 * その月に手に入るか。**空(通年か不明)は手に入る側に数える** —— 時期を持たない
 * スポットの大半は通年のもの(定番の土産・常設の店)で、不明だからと外すと
 * 「今手に入る」で絞った途端にほとんどが消える。時期外と分かっているものだけを外す。
 * 保存済みの値はDBの検査を通っているが、万一読めない値が来たときも同じ理由で手に入る側に倒す。
 */
export function isAvailableInMonth(value: string | null | undefined, month: number): boolean {
  if (!value || value.trim() === "") return true;
  const table = monthTable(value);
  return table ? table[month] === true : true;
}

/** 今(JST)の月に手に入るか(`isAvailableInMonth`の「今」版) */
export function isAvailableNow(
  value: string | null | undefined,
  now: Date | number = Date.now()
): boolean {
  const clock = jstClock(now);
  if (!clock) return true;
  return isAvailableInMonth(value, clock.month);
}

/**
 * 画面に出す形。`11-3` → 「11月〜3月」、`6,7,8` → 「6月・7月・8月」、
 * 12か月すべてを含むなら「通年」。空・読めない値はnull(画面では出さない)。
 */
export function formatAvailableMonths(value: string | null | undefined): string | null {
  if (!value) return null;
  const segments = parseSegments(value);
  if (!segments) return null;
  const table = monthTable(value);
  if (table && table.slice(1).every(Boolean)) return "通年";
  return segments
    .map((s) => (s.from === s.to ? `${s.from}月` : `${s.from}月〜${s.to}月`))
    .join("・");
}
