/**
 * 地図(`MapView`)に渡すGeoJSONの組み立てと、そのための判定(どのルートを出すか・
 * どの日の訪問を結ぶか・重なったピンの数え方)。地図の状態を持たない純粋な関数だけを置く。
 */
import * as maplibregl from "@/lib/maplibre";
import type { Spot, SpotRoute, Visit, VisitPlanList } from "@/lib/types";
import { type SeriesStyleDefinition } from "@/lib/seriesStyle";
import { resolveSpotFace, resolveSpotMark, resolveSpotShape } from "@/lib/spotStyle";
import { pinIconId } from "@/lib/pinIcon";
import { toVisitDateKey, type SpotFilters } from "@/components/FilterBar";
import { DEFAULT_ROUTE_COLOR, ensureRouteArrowImage } from "@/lib/map/layers";
import { hasAllCategories } from "@/lib/category";

/**
 * シリーズ・カテゴリの絞り込みを適用した表示対象のルート(経由地2点以上)を返す。
 * 表示するかどうか自体は絞り込みモーダルの「ルートを表示」トグル
 * (`filters.showRoutes`)だけで決まり、オフなら一切表示しない
 * (かつての「シリーズ・カテゴリで絞り込み中のみ自動表示」ルールは廃止した)。
 * オンならシリーズ・カテゴリの絞り込みが無くても全ルートを表示する。
 *
 * シリーズで絞り込んでいるときは、ルートのseriesがこの種別のシリーズ一覧に
 * あるものだけ絞り込みに連動して出し分け、シリーズ未指定・一覧に無いシリーズの
 * ルートは対象外として表示する。カテゴリで絞り込んでいるときは、ルート自体は
 * カテゴリを持たない(`spot_routes`にcategories相当の列は無い)ため、経由地の
 * カテゴリで代用して「選択中のカテゴリを全部持つ経由地が1つでもあるルート」を表示する。
 * ただしこの判定に使う経由地は、**そのルートのシリーズに属するスポットがあれば
 * それだけ**に絞る(`routeOwnPoints`) — 乗り換え駅・空港のように複数のルートで
 * 共有している経由地に引きずられて、無関係なルートまで表示されるのを防ぐため
 * (例: 「サイコロ1」のスポットである新大阪駅を「サイコロ4」「サイコロ5」
 * 「サイコロ6」のルートも通っているせいで、カテゴリ=サイコロ1で絞ると
 * サイコロ4〜6のルート線まで出ていた)。シリーズが未指定のルートや、自分の
 * シリーズの経由地が1つも無いルートは従来どおり全経由地で判定する。
 * 両方で絞り込んでいるときは両方の条件を満たすルートのみ。
 */
export function filterVisibleRoutes(
  routes: SpotRoute[],
  filters: SpotFilters,
  seriesStyles: SeriesStyleDefinition[],
  spotById: Map<string, Spot>
): SpotRoute[] {
  if (!filters.showRoutes) return [];
  const knownSeries = new Set(seriesStyles.map((s) => s.series));
  return routes.filter((route) => {
    if (route.points.length < 2) return false;
    if (
      filters.series.length > 0 &&
      route.series !== null &&
      knownSeries.has(route.series) &&
      !filters.series.includes(route.series)
    ) {
      return false;
    }
    if (
      filters.categories.length > 0 &&
      !routeOwnPoints(route, spotById).some((s) =>
        hasAllCategories(s.categories, filters.categories)
      )
    ) {
      return false;
    }
    return true;
  });
}

/**
 * カテゴリ絞り込みでルートを判定するときに見る経由地スポットを返す。
 * ルートのシリーズと同じシリーズのスポットがあればそれだけ、無ければ全経由地。
 * (取得できないスポット=他人の非公開等は除く)
 */
function routeOwnPoints(route: SpotRoute, spotById: Map<string, Spot>): Spot[] {
  const spots = route.points
    .map((p) => spotById.get(p.spot_id))
    .filter((s): s is Spot => s !== undefined);
  if (route.series === null) return spots;
  const own = spots.filter((s) => s.series === route.series);
  return own.length > 0 ? own : spots;
}

/**
 * 訪問順の経路の対象期間(`filters.visitedDate`〜`visitedDateTo`)に入る訪問か。
 * 終了日が無ければ開始日だけの単日。日付キーは`YYYY-MM-DD`なので文字列比較でよい。
 */
export function isInVisitedRange(visitedOn: string | null, filters: SpotFilters): boolean {
  const from = filters.visitedDate;
  if (!from) return false;
  const key = toVisitDateKey(visitedOn);
  if (!key) return false;
  return key >= from && key <= (filters.visitedDateTo ?? from);
}

/**
 * 選んだ日(期間)に訪問したスポットのID。
 * 経路(buildVisitPathsByDay)と違い**スポットの解決が要らない**ので、まだ読み込んで
 * いないスポットや別のスポット種別のスポットも含めて「その期間に訪問したか」だけを
 * 判定できる。ピンを絞り込みから免除するかの判定はこちらを使う
 * (重ね表示側はスポットの実体を自前で持っているため、IDが分かれば足りる)。
 */
export function visitedSpotIdsOn(visits: Visit[], filters: SpotFilters): Set<string> {
  if (!filters.visitedDate) return new Set();
  return new Set(
    visits
      .filter((visit) => isInVisitedRange(visit.visited_on, filters))
      .map((visit) => visit.spot_id)
  );
}

/**
 * 訪問順の経路の対象期間(`filters.visitedDate`〜`visitedDateTo`。開始日がnullなら
 * 表示しない)が選ばれているとき、その期間の訪問を**日ごとに分けて**、それぞれ
 * 訪問時刻の昇順に並べた経路を返す(日付の昇順)。
 * **日をまたいでスポットを線で結ばない** —— 宿へ帰って翌朝また出る間の移動は
 * 実際には辿っていないので、繋ぐと1日の道のりが読めなくなるため。
 * 線・詳細・Google マップの経路検索のいずれも日ごとに別のものとして扱う。
 * 別のスポット種別のスポットも、座標を補完できていれば経路に含める(訪問予定リストと
 * 同じ扱い。補完は pathExtraSpots)。解決できないスポットだけを除く。
 * 同じスポットへの再訪はそのまま複数回現れる(行って戻る線になる)が、
 * 連続する同じスポットへの訪問(同じ場所で複数回記録した場合)はまとめる
 * (長さ0の線分になり、矢印の向きが定まらないため)。
 */
export function buildVisitPathsByDay(
  visits: Visit[],
  filters: SpotFilters,
  spotById: Map<string, Spot>
): { date: string; path: Spot[] }[] {
  if (!filters.visitedDate) return [];
  const byDay = new Map<string, { time: number; spot: Spot }[]>();
  for (const visit of visits) {
    if (!isInVisitedRange(visit.visited_on, filters)) continue;
    const spot = spotById.get(visit.spot_id);
    const date = toVisitDateKey(visit.visited_on);
    if (!spot || !date) continue;
    const day = byDay.get(date) ?? [];
    day.push({ time: Date.parse(visit.visited_on!), spot });
    byDay.set(date, day);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, entries]) => ({
      date,
      path: entries
        .sort((a, b) => a.time - b.time)
        .map((v) => v.spot)
        .filter((spot, i, list) => i === 0 || spot.id !== list[i - 1].id),
    }))
    .filter((day) => day.path.length > 0);
}

/**
 * routeId はタップでルート詳細を開くのに使う。訪問順の経路・訪問予定リストの経路には
 * routeId の代わりに pathKind を付け、タップで対応する経路の詳細を開く。
 * 訪問順の経路は日ごとに別の線なので、どの日の線かを pathDate(`YYYY-MM-DD`)で持ち、
 * タップしたときにその日ぶんの詳細を出せるようにする。
 */
export type RouteFeatureProps = {
  color: string;
  icon: string;
  routeId?: string;
  pathKind?: "visit" | "plan";
  pathDate?: string;
};

/**
 * 選んだ訪問予定リスト(旅程)の経路。そのリストのスポットをリスト順に並べる
 * (見えないスポット=未ダウンロード等は除いて残りを繋ぐ)。
 * **訪問済みの経由スポットは経路に載せない** —— 済んだ場所を通り続ける線が
 * 残ると「次にどこへ行くか」が読めなくなるため。リスト自体からは消えないので、
 * 訪問予定リストの詳細では訪問済みとして並んだままになる。
 */
export function buildPlanListPath(
  planLists: VisitPlanList[],
  filters: SpotFilters,
  spotById: Map<string, Spot>
): Spot[] {
  if (!filters.planListId) return [];
  const list = planLists.find((l) => l.id === filters.planListId);
  if (!list) return [];
  const visited = new Set(list.visited_spot_ids);
  return list.spot_ids
    .filter((id) => !visited.has(id))
    .map((id) => spotById.get(id))
    .filter((s): s is Spot => s !== undefined);
}

/**
 * ルートと、地図に重ねる色付きの経路(訪問順の経路・訪問予定リストの経路)を
 * GeoJSONのLineString群にする。矢印画像の登録もここで済ませる。
 * `start`([lng, lat])を渡した経路は、その座標からその経路の先頭までの区間を
 * `startColor`(省略時は経路と同色)の別のLineStringとして繋いで描く
 * (訪問予定リストの経路で「現在地→リスト先頭のスポット」の線を現在地の青丸と
 * 同じ色で引くのに使う。経路のスポットが1件も無いときは始点だけでは線に
 * ならないため繋がない)。
 */
export function buildRouteGeoJSON(
  map: maplibregl.Map,
  routes: SpotRoute[],
  seriesStyles: SeriesStyleDefinition[],
  extraPaths: {
    path: Spot[];
    color: string;
    kind?: "visit" | "plan";
    /** 訪問順の経路で、その線がどの日のものか(`YYYY-MM-DD`) */
    date?: string;
    start?: [number, number] | null;
    startColor?: string;
  }[]
): GeoJSON.FeatureCollection<GeoJSON.LineString, RouteFeatureProps> {
  const extraFeatures: GeoJSON.Feature<GeoJSON.LineString, RouteFeatureProps>[] =
    extraPaths
      .flatMap((p) => [
        // 始点(現在地)→経路先頭の区間。色を分けられるよう独立した線にする
        ...(p.start && p.path.length > 0
          ? [
              {
                ...p,
                color: p.startColor ?? p.color,
                coordinates: [
                  p.start,
                  [p.path[0].lng, p.path[0].lat] as [number, number],
                ],
              },
            ]
          : []),
        { ...p, coordinates: p.path.map((s): [number, number] => [s.lng, s.lat]) },
      ])
      .filter((p) => p.coordinates.length >= 2)
      .map((p) => ({
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: p.coordinates,
        },
        properties: {
          color: p.color,
          icon: ensureRouteArrowImage(map, p.color),
          ...(p.kind ? { pathKind: p.kind } : {}),
          ...(p.date ? { pathDate: p.date } : {}),
        },
      }));

  return {
    type: "FeatureCollection",
    features: [
      ...extraFeatures,
      ...routes.map<GeoJSON.Feature<GeoJSON.LineString, RouteFeatureProps>>(
        (route) => {
          // ルートのシリーズが種別の一覧にあれば、そのシリーズの縁取り色
          // (地の色より濃く、地図上で見やすい)で描く
          const color =
            seriesStyles.find((s) => s.series === route.series)?.borderColor ??
            DEFAULT_ROUTE_COLOR;
          return {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: route.points.map((p) => [p.lng, p.lat]),
            },
            properties: {
              color,
              icon: ensureRouteArrowImage(map, color),
              routeId: route.id,
            },
          };
        }
      ),
    ],
  };
}

type ClusterFeatureProps = {
  id: string;
  series: string | null;
  visited: boolean;
  /** ensurePinImageで登録済みのピン画像ID */
  icon: string;
  /** 同じ座標にあるスポットの数(1なら重なりなし)。重なり数のバッジの表示に使う */
  stack: number;
};

/**
 * 同じ座標のスポットをまとめるためのキー。座標は小数第6位(約0.1m)まで見る。
 * これより粗くすると、隣接する別の建物まで同一地点にまとめてしまう
 */
export function stackKey(spot: Pick<Spot, "lat" | "lng">): string {
  return `${spot.lat.toFixed(6)},${spot.lng.toFixed(6)}`;
}

/**
 * ピンを訪問済みの見た目(緑+✓)で描くか。「訪問済みも元のピンで表示」
 * (`SpotFilters.showVisitedOriginalPin`)がオンなら、訪問していても未訪問と同じ
 * 見た目=ランク・シリーズのピンで描く(色・形・中身でスポットを見分けたいとき、
 * 訪問済みが増えるほど地図が緑一色になってしまうため)。
 * **ピン画像の登録(`ensurePinImage`)と画像ID(`buildClusterGeoJSON`)で
 * 同じ判定を使うこと** —— 食い違うと未登録のIDを指してピンが消える。
 */
export function visitedPinOf(
  spotId: string,
  visitedIds: Set<string>,
  showVisitedOriginalPin: boolean
): boolean {
  return !showVisitedOriginalPin && visitedIds.has(spotId);
}

/** 座標が同じスポットの件数(重なり数のバッジ用)。**表示するスポット全体で数える** */
export function countStacks(spots: Spot[]): Map<string, number> {
  const stacks = new Map<string, number>();
  for (const spot of spots) {
    const k = stackKey(spot);
    stacks.set(k, (stacks.get(k) ?? 0) + 1);
  }
  return stacks;
}

export function buildClusterGeoJSON(
  spots: Spot[],
  visitedIds: Set<string>,
  seriesStyles: SeriesStyleDefinition[],
  rankEnabled: boolean,
  /**
   * 重なり件数。**ソースを分けても表示中の全スポットで数えたものを渡す** ——
   * 分けたあとの集合ごとに数えると、経路上のピンと重なっている普通のピンが
   * バッジに出てこなくなる(クラスタが解けた拡大率では完全に重なるので、
   * 数が出ないと下のピンの存在に気づけない)
   */
  stacks: Map<string, number>,
  /**
   * 訪問済みも元のピン(ランク・シリーズの見た目)で描く
   * (`SpotFilters.showVisitedOriginalPin`)。**プロパティの`visited`は訪問の事実
   * そのものなので落とさず**、見た目(ピン画像)だけを切り替える
   */
  showVisitedOriginalPin: boolean
): GeoJSON.FeatureCollection<GeoJSON.Point, ClusterFeatureProps> {
  return {
    type: "FeatureCollection",
    features: spots.map((spot) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [spot.lng, spot.lat] },
      properties: {
        id: spot.id,
        series: spot.series,
        visited: visitedIds.has(spot.id),
        icon: pinIconId(
          resolveSpotFace(spot.rank, spot.series, seriesStyles, rankEnabled),
          resolveSpotMark(spot.series, seriesStyles),
          resolveSpotShape(spot.series, seriesStyles),
          visitedPinOf(spot.id, visitedIds, showVisitedOriginalPin),
          spot.status === "private"
        ),
        stack: stacks.get(stackKey(spot)) ?? 1,
      },
    })),
  };
}
