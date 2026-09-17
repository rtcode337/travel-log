/**
 * 訪問予定リストの開始日・終了日を、保存する形に正規化する(作成・更新の両APIで共用)。
 *
 * **開始日と終了日はセットで持つ**(両方入っているか、両方nullの「訪問日未定」か)。
 * 片方だけの状態を作らないのは、「開始日なしの終了日」が意味を持たないうえ、
 * 一覧の並び順や天気の基準日がどちらを見るかで変わってしまうため。
 * DB側にも同じ形のcheck制約(`visit_plan_lists_dates_ck`)がある。
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type PlanDatesResult =
  | { ok: true; start: string | null; end: string | null }
  | { ok: false; error: string };

/**
 * - どちらも空(未指定・null含む) …… 訪問日未定(両方null)
 * - 開始日だけ …… 終了日は開始日と同じ(=単日)
 * - 終了日だけ …… エラー(開始日なしでは期間が決まらない)
 */
export function normalizePlanDates(body: {
  start_date?: unknown;
  end_date?: unknown;
}): PlanDatesResult {
  const start = typeof body?.start_date === "string" ? body.start_date.trim() : "";
  const rawEnd = typeof body?.end_date === "string" ? body.end_date.trim() : "";
  if (!start && !rawEnd) {
    return { ok: true, start: null, end: null };
  }
  if (!start) {
    return { ok: false, error: "終了日だけの指定はできません(開始日が必要です)。" };
  }
  // 終了日が空なら開始日と同じ(=単日)にする
  const end = rawEnd || start;
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return { ok: false, error: "訪問予定期間の日付が不正です。" };
  }
  if (end < start) {
    return { ok: false, error: "終了日は開始日以降にしてください。" };
  }
  return { ok: true, start, end };
}
