/**
 * 営業時間(`spots.opening_hours`)。**OpenStreetMap の opening_hours の書式をそのまま**持ち、
 * ここでは**よく使われる部分だけ**を読んで「今営業しているか」と日本語の表記を出す。
 *
 * 読む書き方:
 * - 曜日(`Mo`〜`Su`)・曜日の範囲(`Mo-Fr`。`Sa-Mo`のような週をまたぐ範囲も)・列挙(`Sa,Su`)
 * - 時刻の範囲(`11:00-15:00`)と複数の時間帯(`11:00-15:00,17:00-22:00`)
 * - 日をまたぐ時間帯(`22:00-02:00`・`18:00-26:00`。翌日の朝までその日の営業として数える)
 * - `off` / `closed`(休み)、`24/7`(常に営業)、曜日だけの規則(その曜日は終日営業)
 * - 祝日`PH`(`PH off`・`PH 10:00-17:00`・`Sa,Su,PH 10:00-17:00`)。**今日(JST)が日本の祝日・
 *   振替休日・国民の休日なら`PH`の規則を当て、そうでなければ`PH`だけの規則は飛ばす**
 *   (`lib/japaneseHolidays.ts`。対応する年の範囲外では祝日か分からないので不明)
 * - 月と日付(規則の頭に置く): 月(`Aug off`)・月の範囲(`Mar-Oct`。`Nov-Feb`のような年をまたぐ範囲も)・
 *   日付(`Jan 01 off`)・日付の範囲(`Jan 01-03`・`Dec 29-Jan 03`)・列挙(`Dec 31,Jan 01-06`)。
 *   後ろに`:`を付けた形(`Mar-Oct: Th-Tu 09:30-17:00`)も読む
 * - 第何曜日(`Th[3] off`・`Su[1,3,5]`・`Mo[-1]`=その月の最後の月曜)
 * - `;`で区切った規則は**後のものが前のものをその日について置き換える**(`Mo-Fr 11:00-22:00; We off`・
 *   `Mo-Su 10:00-20:00; Jan 01 off`)。時刻の後ろの`,`に曜日が続くもの(`Mo-Fr 10:00-12:00, Sa 10:00-14:00`)は
 *   置き換えずに足す
 *
 * **読めない書き方は「不明」に倒す**(学校休暇`SH`・週番号・年の指定・
 * 日の出/日の入り・`+`の終わりの無い時刻・`||`・引用符のコメントなど)。
 * 規則が1つでも読めなければ、判定は全体を「不明」にする —— たとえば`SH off`は学校の休みに
 * 休むという意味で、今日が学校の休みかを知らない以上、残りの規則だけで「営業中」と言い切れない。
 *
 * **依存は増やさず、ここに最小限を書く。** npm の opening_hours は書式を全部読めて保守も
 * 続いているが、ライセンスが LGPL-3.0 で(このアプリは MIT で、ブラウザ向けの束に入る)、
 * 展開で約5MB・i18next などの依存も連れてくる。使うのはこの一部だけなので見合わない。
 *
 * 判定の「今」はJST(`jstClock`)。海外のスポットも日本時間で比べるので、
 * 現地の時刻とはずれる(タイムゾーンを持たないため)。
 */
import { jstClock } from "@/lib/datetime";
import { isJapaneseHoliday } from "@/lib/japaneseHolidays";

/** 判定の答え。営業中 / 営業時間外 / 不明(空・読めない書き方) */
export type OpeningState = "open" | "closed" | "unknown";

export const OPENING_STATE_LABELS: Record<OpeningState, string> = {
  open: "営業中",
  closed: "営業時間外",
  unknown: "営業時間不明",
};

const WEEKDAYS = ["mo", "tu", "we", "th", "fr", "sa", "su"] as const;
const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];
const DAY_MINUTES = 24 * 60;

/** 1つの時間帯(分)。`end`は翌日にかかるとき`DAY_MINUTES`を超える */
interface TimeSpan {
  start: number;
  end: number;
}

/** 月日の範囲(`月*100+日`。`from > to`なら年をまたぐ) */
interface DateRange {
  from: number;
  to: number;
}

/** 読めた規則1つ。`days`は月曜=0。`spans`が空なら休み */
interface Rule {
  days: number[];
  /** 第何曜日の指定(曜日 → 何番目の並び。`-1`は最後)。指定の無い曜日は毎週 */
  nth: Record<number, number[]>;
  /** 当てる月日(空なら毎日) */
  dates: DateRange[];
  /** 祝日(`PH`)にも当てる規則 */
  holiday: boolean;
  spans: TimeSpan[];
  /** `,`で前の規則に足すもの(置き換えない) */
  additional: boolean;
  /** 表示用の日本語(曜日と時刻) */
  label: string;
}

/** 解析の結果。`unreadable`が1つでもあれば判定は不明 */
interface ParsedHours {
  rules: Rule[];
  unreadable: string[];
  /** 画面に出す行(読めた規則は日本語、読めないものは書いてあるまま) */
  lines: string[];
}

const TIME_RE = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;

function parseTimeSpan(text: string): TimeSpan | null {
  const m = TIME_RE.exec(text);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  let end = Number(m[3]) * 60 + Number(m[4]);
  if (Number(m[2]) > 59 || Number(m[4]) > 59) return null;
  if (start >= DAY_MINUTES || end > 2 * DAY_MINUTES) return null;
  // 終わりが始まり以前なら翌日にかかる(22:00-02:00)。同じ時刻は意味が決まらないので読まない
  if (end === start) return null;
  if (end < start) end += DAY_MINUTES;
  if (end - start > DAY_MINUTES) return null;
  return { start, end };
}

function formatClock(minutes: number): string {
  const nextDay = minutes > DAY_MINUTES;
  const m = nextDay ? minutes - DAY_MINUTES : minutes;
  const text = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  return nextDay ? `翌${text}` : text;
}

function formatSpan(span: TimeSpan): string {
  return `${formatClock(span.start)}〜${formatClock(span.end)}`;
}

/** 曜日の指定(`Mo-Fr,Su`)を月曜=0の配列と表記にする。読めなければnull */
function parseDays(
  text: string
): { days: number[]; nth: Record<number, number[]>; holiday: boolean; label: string } | null {
  const days: number[] = [];
  const nth: Record<number, number[]> = {};
  const labels: string[] = [];
  let holiday = false;
  // `Su[1,3,5]`の中の`,`では切らない
  for (const raw of text.split(/,(?![^[]*\])/)) {
    // 第何曜日(`Th[3]`・`Su[1,3,5]`・`Mo[-1]`)。範囲(`Mo-Fr[1]`)には付けない
    const nthMatch = /^\s*([A-Za-z]{2})\[([-\d,\s]+)\]\s*$/.exec(raw);
    if (nthMatch) {
      const day = WEEKDAYS.indexOf(nthMatch[1].toLowerCase() as (typeof WEEKDAYS)[number]);
      const order = nthMatch[2].split(",").map((n) => Number(n.trim()));
      if (day === -1 || order.some((n) => !Number.isInteger(n) || n === 0 || n < -1 || n > 5)) {
        return null;
      }
      if (!days.includes(day)) days.push(day);
      nth[day] = order;
      labels.push(
        order.map((n) => (n === -1 ? "最終" : `第${n}`)).join("・") + WEEKDAY_LABELS[day]
      );
      continue;
    }
    const part = raw;
    // 祝日(PH)は曜日と並べて書ける(`Sa,Su,PH`)。範囲(`Mo-PH`)にはならない
    if (part.trim().toLowerCase() === "ph") {
      holiday = true;
      labels.push("祝日");
      continue;
    }
    const range = part.trim().toLowerCase().split("-");
    if (range.length > 2) return null;
    const from = WEEKDAYS.indexOf(range[0] as (typeof WEEKDAYS)[number]);
    const to =
      range.length === 2 ? WEEKDAYS.indexOf(range[1] as (typeof WEEKDAYS)[number]) : from;
    if (from === -1 || to === -1) return null;
    // 週をまたぐ範囲(Sa-Mo)も読む
    for (let d = from; ; d = (d + 1) % 7) {
      if (!days.includes(d)) days.push(d);
      if (d === to) break;
    }
    labels.push(
      from === to ? WEEKDAY_LABELS[from] : `${WEEKDAY_LABELS[from]}〜${WEEKDAY_LABELS[to]}`
    );
  }
  return { days, nth, holiday, label: labels.join("・") };
}

/**
 * 曜日の部分。2文字の語が`,`・`-`で繋がったもの(`off`の頭の`of`を拾わないよう語の境目で切る)。
 * 第何曜日の`[...]`も付けられる(`Mo,Su[1,3,5]`)
 */
const DAYS_PREFIX_RE =
  /^([A-Za-z]{2}\b(?:-[A-Za-z]{2}\b|\[[-\d,\s]+\])?(?:\s*,\s*[A-Za-z]{2}\b(?:-[A-Za-z]{2}\b|\[[-\d,\s]+\])?)*)\s*(.*)$/;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_RE = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
/** 月日の指定1つ(`Mar`・`Mar-Oct`・`Jan 01`・`Jan 01-03`・`Dec 29-Jan 03`) */
// 日の後ろに`:`や数字が続くものは時刻(`Apr-Nov 11:00-15:00`の`11`を日と読まない)
const DAY_NUM = "(\\d{1,2})(?![\\d:])";
const DATE_ITEM = `${MONTH_RE}\\b(?:\\s+${DAY_NUM})?(?:\\s*-\\s*(?:${MONTH_RE}\\b(?:\\s+${DAY_NUM})?|${DAY_NUM}))?`;
/** 規則の頭の月日の指定(列挙と、後ろの`:`も含む) */
const DATES_PREFIX_RE = new RegExp(
  `^(${DATE_ITEM.replace(/\((?!\?)/g, "(?:")}(?:\\s*,\\s*${DATE_ITEM.replace(/\((?!\?)/g, "(?:")})*)\\s*:?\\s*(.*)$`,
  "i"
);
const DATE_ITEM_RE = new RegExp(`^${DATE_ITEM}$`, "i");

function monthOf(name: string): number {
  return MONTHS.indexOf(name.toLowerCase()) + 1;
}

/** 月日の指定(`Dec 31,Jan 01-06`)を範囲と表記にする。読めなければnull */
function parseDates(text: string): { dates: DateRange[]; label: string } | null {
  const dates: DateRange[] = [];
  const labels: string[] = [];
  for (const raw of text.split(",")) {
    const m = DATE_ITEM_RE.exec(raw.trim());
    if (!m) return null;
    const fromMonth = monthOf(m[1]);
    const fromDay = m[2] ? Number(m[2]) : null;
    // 終わりの月(`Dec 29-Jan 03`・`Mar-Oct`)か、同じ月の終わりの日(`Jan 01-03`)
    const toMonth = m[3] ? monthOf(m[3]) : fromMonth;
    const toDay = m[4] ? Number(m[4]) : m[5] ? Number(m[5]) : null;
    if (fromDay !== null && (fromDay < 1 || fromDay > MONTH_DAYS[fromMonth - 1])) return null;
    if (toDay !== null && (toDay < 1 || toDay > MONTH_DAYS[toMonth - 1])) return null;
    // 月だけ(`Mar`・`Mar-Oct`)は月の頭から終わりまで。片方だけ日付のある形(`Mar 10-Oct`)は読まない
    if (m[3] && (fromDay === null) !== (toDay === null)) return null;
    const hasRange = m[3] !== undefined || m[5] !== undefined;
    const from = fromMonth * 100 + (fromDay ?? 1);
    const to = toMonth * 100 + (toDay ?? (fromDay !== null && !hasRange ? fromDay : MONTH_DAYS[toMonth - 1]));
    dates.push({ from, to });
    const fmt = (v: number, withDay: boolean) =>
      withDay ? `${Math.floor(v / 100)}月${v % 100}日` : `${Math.floor(v / 100)}月`;
    const withDay = fromDay !== null;
    labels.push(from === to ? fmt(from, withDay) : `${fmt(from, withDay)}〜${fmt(to, withDay)}`);
  }
  return { dates, label: labels.join("・") };
}

function parseRule(text: string, additional: boolean): Rule | null {
  let source = text.trim();
  // 規則の頭の月日の指定(`Jan 01 off`・`Mar-Oct: Th-Tu 09:30-17:00`)
  let dates: DateRange[] = [];
  let dateLabel = "";
  const datePrefix = DATES_PREFIX_RE.exec(source);
  if (datePrefix) {
    const parsed = parseDates(datePrefix[1]);
    if (!parsed) return null;
    dates = parsed.dates;
    dateLabel = parsed.label;
    source = datePrefix[2].trim();
  }
  const rule = parseWeekRule(source, additional);
  if (!rule) return null;
  if (!dateLabel) return rule;
  // 月日だけの規則(`Jan 01 off`)は「毎日」を言わない
  const label = rule.label.startsWith("毎日 ")
    ? `${dateLabel} ${rule.label.slice("毎日 ".length)}`
    : `${dateLabel} ${rule.label}`;
  return { ...rule, dates, label };
}

/** 月日の指定を外した残り(曜日と時刻)を読む */
function parseWeekRule(source: string, additional: boolean): Rule | null {
  if (source === "24/7") {
    return {
      days: [0, 1, 2, 3, 4, 5, 6],
      nth: {},
      dates: [],
      holiday: false,
      spans: [{ start: 0, end: DAY_MINUTES }],
      additional,
      label: "24時間営業",
    };
  }
  let days = [0, 1, 2, 3, 4, 5, 6];
  let nth: Record<number, number[]> = {};
  let holiday = false;
  let everyDay = true;
  let dayLabel = "毎日";
  let rest = source;
  const prefix = DAYS_PREFIX_RE.exec(source);
  if (prefix) {
    const parsed = parseDays(prefix[1]);
    // `SH`・`Jan`の頭など、曜日でも`PH`でもない2文字の語は読まない
    if (!parsed) return null;
    days = parsed.days;
    nth = parsed.nth;
    holiday = parsed.holiday;
    everyDay = false;
    dayLabel = parsed.label;
    rest = prefix[2].trim();
  }
  const lower = rest.toLowerCase();
  if (lower === "off" || lower === "closed") {
    return { days, nth, dates: [], holiday, spans: [], additional, label: `${dayLabel} 休み` };
  }
  // 曜日だけ(時刻なし)・`open`はその曜日を終日営業とみなす(書式の決まり)
  if ((rest === "" && !everyDay) || lower === "open") {
    return {
      days,
      nth,
      dates: [],
      holiday,
      spans: [{ start: 0, end: DAY_MINUTES }],
      additional,
      label: `${dayLabel} 終日`,
    };
  }
  if (rest === "") return null;
  const spans: TimeSpan[] = [];
  // `11:00 - 15:00 , 17:00-22:00`のような区切りの前後の空白は許す
  for (const part of rest.replace(/\s*([-,])\s*/g, "$1").split(",")) {
    const span = parseTimeSpan(part.trim());
    if (!span) return null;
    spans.push(span);
  }
  return {
    days,
    nth,
    dates: [],
    holiday,
    spans,
    additional,
    label: `${dayLabel} ${spans.map(formatSpan).join("、")}`,
  };
}

/** 時刻のすぐ後ろ(または`off`の後ろ)の`,`に語が続くところで、足す規則に分ける */
const ADDITIONAL_SPLIT_RE = /(?<=\d{2}:\d{2}|\boff|\bclosed|\bopen)\s*,\s*(?=[A-Za-z])/i;

// 同じ文字列を何度も解析しないよう覚えておく(地図は数万件を毎回判定するため)。
// 種別の件数より大きくはならないが、念のため溜まりすぎたら捨てる
const parseCache = new Map<string, ParsedHours>();
const PARSE_CACHE_MAX = 20000;

function parseOpeningHours(value: string): ParsedHours {
  const cached = parseCache.get(value);
  if (cached) return cached;
  const rules: Rule[] = [];
  const unreadable: string[] = [];
  const lines: string[] = [];
  // `||`(前の規則が当てはまらないときの代わり)と引用符のコメントは意味を読み切れない
  const whole = value.includes("||") || value.includes('"');
  for (const ruleText of value.split(";")) {
    const trimmed = ruleText.trim();
    if (trimmed === "") continue;
    if (whole) {
      unreadable.push(trimmed);
      lines.push(trimmed);
      continue;
    }
    const pieces = trimmed.split(ADDITIONAL_SPLIT_RE);
    const parsedPieces = pieces.map((piece, i) => parseRule(piece, i > 0));
    if (parsedPieces.some((r) => r === null)) {
      unreadable.push(trimmed);
      lines.push(trimmed);
      continue;
    }
    for (const rule of parsedPieces as Rule[]) {
      rules.push(rule);
      lines.push(rule.label);
    }
  }
  const result = { rules, unreadable, lines };
  if (parseCache.size >= PARSE_CACHE_MAX) parseCache.clear();
  parseCache.set(value, result);
  return result;
}

/**
 * その日(曜日と、祝日かどうか)の時間帯を組み立てる。規則を書いた順に見て、その日に当たる
 * `;`の規則は時間帯を置き換え、`,`で足した規則は足す。**祝日なら`PH`を含む規則も当たり、
 * 後に書いたものが勝つ**(`Mo-Fr 10:00-18:00; PH off`の祝日の月曜は休み)。祝日でなければ
 * `PH`だけの規則は当たらない。**翌日にかかる時間帯は、始まった日のもの**として持つ
 * (判定で前の日から引き継ぐ)。
 */
interface Day {
  year: number;
  month: number;
  day: number;
  weekday: number;
  holiday: boolean;
}

function inDates(dates: DateRange[], day: Day): boolean {
  if (dates.length === 0) return true;
  const at = day.month * 100 + day.day;
  return dates.some((r) => (r.from <= r.to ? r.from <= at && at <= r.to : at >= r.from || at <= r.to));
}

/** その日が、規則の曜日(第何曜日の指定を含む)に当たるか */
function onWeekday(rule: Rule, day: Day): boolean {
  if (!rule.days.includes(day.weekday)) return false;
  const order = rule.nth[day.weekday];
  if (!order) return true;
  const nthOfMonth = Math.ceil(day.day / 7);
  const daysInMonth = new Date(Date.UTC(day.year, day.month, 0)).getUTCDate();
  const isLast = day.day + 7 > daysInMonth;
  return order.some((n) => (n === -1 ? isLast : n === nthOfMonth));
}

function daySpans(rules: Rule[], day: Day): TimeSpan[] {
  let spans: TimeSpan[] = [];
  for (const rule of rules) {
    if (!inDates(rule.dates, day)) continue;
    if (!onWeekday(rule, day) && !(day.holiday && rule.holiday)) continue;
    spans = rule.additional ? [...spans, ...rule.spans] : [...rule.spans];
  }
  return spans;
}

/**
 * その時点(JST)で営業しているか。空・読めない書き方を含むものは「不明」。
 */
export function openingStateAt(
  value: string | null | undefined,
  now: Date | number = Date.now()
): OpeningState {
  if (!value || value.trim() === "") return "unknown";
  const clock = jstClock(now);
  if (!clock) return "unknown";
  const parsed = parseOpeningHours(value.trim());
  if (parsed.unreadable.length > 0 || parsed.rules.length === 0) return "unknown";
  // 前の日(日付をまたいだ時間帯を引き継ぐため)も祝日かどうかが要る
  const prevClock = jstClock(new Date(now).getTime() - DAY_MINUTES * 60_000);
  if (!prevClock) return "unknown";
  const usesHoliday = parsed.rules.some((r) => r.holiday);
  const holidayOf = (c: { year: number; month: number; day: number }) =>
    usesHoliday ? isJapaneseHoliday(c.year, c.month, c.day) : false;
  const todayHoliday = holidayOf(clock);
  const prevHoliday = holidayOf(prevClock);
  // 祝日の規則があるのに、祝日かどうか分からない年(対応範囲外)は言い切らない
  if (todayHoliday === null || prevHoliday === null) return "unknown";
  const { minutes } = clock;
  if (
    daySpans(parsed.rules, { ...clock, holiday: todayHoliday }).some(
      (s) => s.start <= minutes && minutes < s.end
    )
  ) {
    return "open";
  }
  // 前の日に始まって日付をまたいだ時間帯(22:00-02:00 の 1:00 など)
  if (
    daySpans(parsed.rules, { ...prevClock, holiday: prevHoliday }).some(
      (s) => s.end > DAY_MINUTES && minutes < s.end - DAY_MINUTES
    )
  ) {
    return "open";
  }
  return "closed";
}

/**
 * 画面に出す日本語の行(例「月〜金 11:00〜15:00、17:00〜22:00」「水 休み」)。
 * 読めない規則は書いてあるままの行で出し、`unreadable`で知らせる(判定は不明になる)。
 * 空ならnull。
 */
export function describeOpeningHours(
  value: string | null | undefined
): { lines: string[]; unreadable: boolean } | null {
  if (!value || value.trim() === "") return null;
  const parsed = parseOpeningHours(value.trim());
  return { lines: parsed.lines, unreadable: parsed.unreadable.length > 0 };
}

/**
 * 保存する形に整える(前後の空白を落とす。空はnull)。**読めない書き方でも弾かない** ——
 * 渡されるデータの1件の書き方で取り込み全体が止まると、ほかの行まで入らなくなる。
 * 読めない部分は判定で「不明」に倒すので、保存しておいて害は無い
 * (読める範囲が増えれば、取り込み直さずにそのまま効く)。
 */
export function normalizeOpeningHours(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}
