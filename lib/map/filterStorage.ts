/**
 * 地図の絞り込みと重ね表示の選択を、スポット種別ごとにlocalStorageへ保存・復元する。
 */
import { isRank, NO_RANK, type RankFilterValue } from "@/lib/rank";
import { DEFAULT_FILTERS, type SpotFilters, type VisitedValue } from "@/components/FilterBar";

/**
 * 地図でかけた絞り込み条件はスポット種別ごとにlocalStorageへ保存し、
 * 他画面から戻ったときだけでなく、アプリ(PWA)やブラウザを完全に落として
 * 開き直したときも復元する(表示位置のlastViewsと違い、再読み込みでは消えない)。
 */
export const FILTERS_STORAGE_PREFIX = "travel-log:map-filters:";

/** 今日のローカル日付(`YYYY-MM-DD`)。訪問順の経路の既定対象日に使う */
export function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 1年前の同じ日(`YYYY-MM-DD`)。「過去1年」の開始日に使う。
 *
 * **`Date`に任せて年だけ引く**ので、2月29日は3月1日に送られる(閏年でない年に
 * 2月29日は無いため)。1日ずれるだけで、絞り込みの範囲としては困らない。
 */
export function oneYearAgoKey(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 訪問順の経路の対象日を既定(今日)にした絞り込み条件 */
export function defaultMapFilters(): SpotFilters {
  return { ...DEFAULT_FILTERS, visitedDate: todayKey() };
}

/**
 * 実際に効かせる「これだけを表示」。対象(訪問日 / 訪問予定リスト)が選ばれていない
 * isolateは無視して通常表示に戻す(選択を「表示しない」に変えたのに何も出ない状態を防ぐ)。
 */
export function effectiveIsolate(filters: SpotFilters): "visit" | "plan" | null {
  if (filters.isolate === "visit") return filters.visitedDate ? "visit" : null;
  if (filters.isolate === "plan") return filters.planListId ? "plan" : null;
  return null;
}

/**
 * 保存済みの絞り込み条件を読む。未保存・不正値は既定(訪問順の経路=今日)を返す。
 * `visitedDate`は絞り込みではなく訪問順の経路の対象日で、既定は今日。「表示しない」は
 * 保存時に文字列`"none"`で書く(下記`saveFilters`)ため、`"none"`のときだけnull=表示
 * しないにする。「今日」は`"today"`で保存されるので、読み込み時のその日の`todayKey()`に
 * 解決する(日付を固定しないので、翌日に開いてもその日が今日として選ばれる)。旧仕様の
 * 保存値(絞り込みだった頃のnull・日付、キー欠落)は「明示的な表示しない」ではないので
 * 今日に倒す(既存ユーザーも初回から今日の経路が出る)。
 */
export function loadSavedFilters(typeKey: string): SpotFilters {
  if (typeof localStorage === "undefined") return defaultMapFilters();
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_PREFIX + typeKey);
    if (!raw) return defaultMapFilters();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaultMapFilters();
    const obj = parsed as Record<string, unknown>;
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    // 訪問日は`YYYY-MM-DD`のみ受け付ける
    const date = (v: unknown): string | null =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    const visited = strings(obj.visited).filter(
      (v): v is VisitedValue => v === "visited" || v === "unvisited"
    );
    return {
      // ランクの保存値。A〜Eと"none"(ランクなし)以外は捨てる
      // (キー欠落=この項目より前の保存データは絞り込みなし)
      ranks: strings(obj.ranks).filter((v): v is RankFilterValue =>
        v === NO_RANK || isRank(v)
      ),
      series: strings(obj.series),
      categories: strings(obj.categories),
      // **空配列は「すべて」として保存された値**なのでそのまま使う。
      // キー自体が無いとき(この項目より前の保存データ)だけ既定=未訪問のみに倒す
      // —— 空を既定へ倒すと、「すべて」を選んで地図を開き直すたびに未訪問へ戻る
      visited: Array.isArray(obj.visited) ? visited : [...DEFAULT_FILTERS.visited],
      // "none"=表示しない、"today"=(その日ではなく)常に今日、日付=その日、
      // それ以外(旧null・キー欠落など)=今日
      visitedDate:
        obj.visitedDate === "none"
          ? null
          : obj.visitedDate === "today"
            ? todayKey()
            : date(obj.visitedDate) ?? todayKey(),
      // 期間の終了日。キー欠落(この項目より前の保存データ)・不正値は単日扱い。
      // 「今日」のような相対表現は持たない —— 終了日だけ動くと期間の長さが
      // 日をまたぐたびに変わってしまうため、具体的な日付でだけ保存する
      visitedDateTo: date(obj.visitedDateTo),
      // 訪問予定リストの経路対象(そのリストが今も存在するかは描画側で解決する)
      planListId: typeof obj.planListId === "string" ? obj.planListId : null,
      // キー自体が無い保存データ(この設定の追加前に保存されたもの)は既定のオン扱い
      showRoutes: typeof obj.showRoutes === "boolean" ? obj.showRoutes : true,
      disableCluster:
        typeof obj.disableCluster === "boolean" ? obj.disableCluster : false,
      showVisitedOriginalPin:
        typeof obj.showVisitedOriginalPin === "boolean"
          ? obj.showVisitedOriginalPin
          : false,
      // 「これだけを表示」は一時的な注視モードのため復元しない(開き直しで地図が
      // 1経路だけに絞られたまま=ほぼ空、という分かりにくい状態を避ける)
      isolate: null,
    };
  } catch {
    return defaultMapFilters();
  }
}

export function saveFilters(typeKey: string, filters: SpotFilters) {
  try {
    // visitedDate の保存表現:
    // - null(表示しない) → "none"(旧仕様の「絞り込みなしのnull」と区別。loadSavedFilters参照)
    // - 今日(todayKey()と一致) → "today"(具体的な日付ではなく「今日」の意図で保存する。
    //   でないと日付が固定され、翌日に前日が選ばれた状態で復元されてしまう。「今日」は
    //   セレクトの選択肢として today のみで、others からは today を除いているため、
    //   visitedDate が todayKey() と一致するのは「今日」を選んだときだけと判断できる)
    // - それ以外の具体的な日付 → その日付をそのまま保存
    const storedVisitedDate =
      filters.visitedDate == null
        ? "none"
        : filters.visitedDate === todayKey()
          ? "today"
          : filters.visitedDate;
    const stored = { ...filters, visitedDate: storedVisitedDate };
    localStorage.setItem(FILTERS_STORAGE_PREFIX + typeKey, JSON.stringify(stored));
  } catch {
    // プライベートブラウズ等で保存できなくても絞り込み自体は動かす
  }
}

/**
 * 重ね表示する種別の選択も、絞り込み条件と同様に(表示中の)種別ごとに保存・復元する。
 * 複数種別を重ねられるようにしたため、値はキーのJSON配列(選んだ順=描画順)で保存する。
 * 単一種別しか重ねられなかった頃の保存値(生のキー1つ)も読めるようにしてある
 */
export const OVERLAY_STORAGE_PREFIX = "travel-log:map-overlay:";

export function loadSavedOverlayTypeKeys(typeKey: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(OVERLAY_STORAGE_PREFIX + typeKey);
    if (!raw) return [];
    let keys: string[];
    try {
      const parsed: unknown = JSON.parse(raw);
      keys = Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === "string")
        : // JSONとして読めるが配列でない値(旧形式でキーが数字だった等)は単一指定扱い
          [raw];
    } catch {
      // 旧形式(キーをそのまま保存していた頃)
      keys = [raw];
    }
    // 自分自身を重ねる設定・重複は不正値として無視する
    return keys.filter((k, i) => k !== typeKey && keys.indexOf(k) === i);
  } catch {
    return [];
  }
}

export function saveOverlayTypeKeys(typeKey: string, overlays: string[]) {
  try {
    if (overlays.length > 0) {
      localStorage.setItem(
        OVERLAY_STORAGE_PREFIX + typeKey,
        JSON.stringify(overlays)
      );
    } else {
      localStorage.removeItem(OVERLAY_STORAGE_PREFIX + typeKey);
    }
  } catch {
    // 保存できなくてもこのセッションの重ね表示自体は動かす
  }
}
