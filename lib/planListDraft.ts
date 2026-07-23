/**
 * 訪問予定リストの作成途中の下書き。作成モーダル(SpotsView)で基本情報を入力した後、
 * 地図(MapView)へ遷移してスポットを選ぶため、ページ遷移をまたいで保持する必要がある。
 * 「入力完了」を押すまではDBに保存しないので、種別ごとにlocalStorageへ置いておく。
 */

export interface PlanListDraft {
  title: string;
  description: string | null;
  /** `YYYY-MM-DD` */
  start_date: string;
  end_date: string;
  /** 選択済みスポットのID(選んだ順) */
  spotIds: string[];
}

/** `YYYY-MM-DD` → `2026年7月24日`。不正値はそのまま返す */
function formatPlanDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

/** 訪問予定期間の表記。開始日=終了日なら単日、違えば「開始〜終了」 */
export function formatPlanDateRange(start: string, end: string): string {
  return start === end
    ? formatPlanDate(start)
    : `${formatPlanDate(start)}〜${formatPlanDate(end)}`;
}

const PREFIX = "travel-log:plan-list-draft:";

export function loadPlanListDraft(typeKey: string): PlanListDraft | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PREFIX + typeKey);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<PlanListDraft>;
    if (
      typeof d?.title !== "string" ||
      typeof d?.start_date !== "string" ||
      typeof d?.end_date !== "string"
    ) {
      return null;
    }
    return {
      title: d.title,
      description: typeof d.description === "string" ? d.description : null,
      start_date: d.start_date,
      end_date: d.end_date,
      spotIds: Array.isArray(d.spotIds)
        ? d.spotIds.filter((s): s is string => typeof s === "string")
        : [],
    };
  } catch {
    return null;
  }
}

export function savePlanListDraft(typeKey: string, draft: PlanListDraft): void {
  try {
    localStorage.setItem(PREFIX + typeKey, JSON.stringify(draft));
  } catch {
    // 保存できなくても作成フロー自体は同一セッション内のstateで続行できる
  }
}

export function clearPlanListDraft(typeKey: string): void {
  try {
    localStorage.removeItem(PREFIX + typeKey);
  } catch {
    // 無視
  }
}
