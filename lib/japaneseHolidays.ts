/**
 * 日本の祝日(「国民の祝日に関する法律」の祝日・振替休日・国民の休日)の判定。
 * 営業時間の`PH`(祝日)の規則を当てるかを決めるのに使う(lib/openingHours.ts)。
 *
 * **対応する年は2000〜2099年。** 範囲外はnull(分からない)を返す。
 * - 春分・秋分の日は国立天文台の暦要項で前年に決まるが、ここでは1980〜2099年に合う
 *   近似式で求める(この範囲では暦要項と一致する)。下限を2000年にしたのは、成人の日・
 *   体育の日がハッピーマンデーになったのが2000年からで、それより前の規則を持たないため
 * - 法改正・特例は2000年以降のものを入れてある(海の日・敬老の日の月曜化=2003年、
 *   昭和の日・振替休日の拡張=2007年、山の日=2016年、天皇誕生日の移動と2019年の即位関連、
 *   東京五輪による2020・2021年の移動)。**今後の改正は入っていない**ので、法が変わったら直す
 *
 * 引数は**JSTの日付**(年・月・日)。日時からJSTの日付にするのは呼び出し側(`jstClock`)。
 */

/** 年・月の第n月曜日の日 */
function nthMonday(year: number, month: number, n: number): number {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstMonday = 1 + ((8 - firstWeekday) % 7);
  return firstMonday + (n - 1) * 7;
}

/** 春分・秋分の日(1980〜2099年に合う近似式) */
function equinoxDay(year: number, base: number): number {
  return Math.floor(base + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

const key = (month: number, day: number) => `${month}-${day}`;

/** その年の「国民の祝日」そのもの(振替休日・国民の休日を除く) */
function statutoryHolidays(year: number): Set<string> {
  const days = new Set<string>();
  const add = (month: number, day: number) => days.add(key(month, day));
  add(1, 1); // 元日
  add(1, nthMonday(year, 1, 2)); // 成人の日
  add(2, 11); // 建国記念の日
  if (year >= 2020) add(2, 23); // 天皇誕生日(2020年から)
  else if (year <= 2018) add(12, 23); // 天皇誕生日(2018年まで。2019年は無い)
  add(3, equinoxDay(year, 20.8431)); // 春分の日
  add(4, 29); // 昭和の日(2006年まではみどりの日)
  add(5, 3); // 憲法記念日
  if (year >= 2007) add(5, 4); // みどりの日(2006年までは国民の休日として下で拾う)
  add(5, 5); // こどもの日
  // 海の日(2003年から7月第3月曜。2020・2021年は東京五輪で移動)
  if (year === 2020) add(7, 23);
  else if (year === 2021) add(7, 22);
  else if (year >= 2003) add(7, nthMonday(year, 7, 3));
  else add(7, 20);
  // 山の日(2016年から。2020・2021年は移動)
  if (year === 2020) add(8, 10);
  else if (year === 2021) add(8, 8);
  else if (year >= 2016) add(8, 11);
  // 敬老の日(2003年から9月第3月曜)
  add(9, year >= 2003 ? nthMonday(year, 9, 3) : 15);
  add(9, equinoxDay(year, 23.2488)); // 秋分の日
  // スポーツの日(2019年までは体育の日。10月第2月曜。2020・2021年は移動)
  if (year === 2020) add(7, 24);
  else if (year === 2021) add(7, 23);
  else add(10, nthMonday(year, 10, 2));
  add(11, 3); // 文化の日
  add(11, 23); // 勤労感謝の日
  if (year === 2019) {
    add(5, 1); // 天皇の即位の日
    add(10, 22); // 即位礼正殿の儀の行われる日
  }
  return days;
}

const cache = new Map<number, Set<string>>();

/** その年の祝日・振替休日・国民の休日の全部(`月-日`の集合) */
function holidaysOf(year: number): Set<string> {
  const cached = cache.get(year);
  if (cached) return cached;
  const statutory = statutoryHolidays(year);
  const all = new Set(statutory);
  const dateOf = (month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
  const keyOf = (d: Date) =>
    d.getUTCFullYear() === year ? key(d.getUTCMonth() + 1, d.getUTCDate()) : null;
  for (const k of statutory) {
    const [month, day] = k.split("-").map(Number);
    const d = dateOf(month, day);
    // 振替休日: 祝日が日曜なら、2007年からは「その後の最初の祝日でない日」、
    // 2006年までは翌日(月曜)
    if (d.getUTCDay() === 0) {
      const next = new Date(d);
      do {
        next.setUTCDate(next.getUTCDate() + 1);
      } while (year >= 2007 && statutory.has(keyOf(next) ?? ""));
      const nk = keyOf(next);
      if (nk) all.add(nk);
    }
    // 国民の休日: 前日と翌日が祝日で、その日自体は祝日でない日(5/4・敬老の日と秋分の間など)。
    // 日曜は除く(2006年までの法文が明記。日曜の5/4は休日にならない ——2003年5月4日がそれで、
    // 内閣府の祝日一覧にも載っていない)。2007年からの5/4は祝日なので、残る9月の例は日曜に当たらない
    const after = new Date(d);
    after.setUTCDate(after.getUTCDate() + 1);
    const afterNext = new Date(d);
    afterNext.setUTCDate(afterNext.getUTCDate() + 2);
    const ak = keyOf(after);
    const ank = keyOf(afterNext);
    if (ak && ank && after.getUTCDay() !== 0 && !statutory.has(ak) && statutory.has(ank)) {
      all.add(ak);
    }
  }
  cache.set(year, all);
  return all;
}

/** 対応する年の範囲(この外はnull) */
export const HOLIDAY_YEAR_MIN = 2000;
export const HOLIDAY_YEAR_MAX = 2099;

/**
 * JSTのその日が祝日・振替休日・国民の休日か。対応する年の範囲外はnull(分からない)。
 */
export function isJapaneseHoliday(year: number, month: number, day: number): boolean | null {
  if (year < HOLIDAY_YEAR_MIN || year > HOLIDAY_YEAR_MAX) return null;
  return holidaysOf(year).has(key(month, day));
}

/** その年の休日の一覧(`MM-DD`の昇順)。テストと確認用。範囲外は空 */
export function japaneseHolidayList(year: number): string[] {
  if (year < HOLIDAY_YEAR_MIN || year > HOLIDAY_YEAR_MAX) return [];
  return [...holidaysOf(year)]
    .map((k) => {
      const [m, d] = k.split("-");
      return `${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    })
    .sort();
}
