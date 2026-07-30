/**
 * Google マップの経路検索(Maps URLs の dir)へのリンクを組み立てる。
 * https://developers.google.com/maps/documentation/urls/get-started#directions-action
 */

/**
 * Maps URLs の経路検索に指定できる経由地(waypoints)の上限。
 * ドキュメント上の上限は9件で、超えた分は無視されるだけでなくURL自体が
 * 正しく解釈されないことがあるため、送る側で間引く
 */
export const GOOGLE_MAPS_MAX_WAYPOINTS = 9;

/**
 * スポットの並び(ルート・経路)をGoogle マップの経路検索で開くURLを作る。
 * 先頭を出発地(origin)、最後を目的地(destination)、間を経由地(waypoints)にする。
 * 経由地が上限(GOOGLE_MAPS_MAX_WAYPOINTS)を超えるときは、経路の形をなるべく
 * 保つよう並び順のまま等間隔に間引き、省いた件数をomittedCountで返す
 * (呼び出し側が注記を出す)。2点未満は経路にならないためnull
 */
export function buildGoogleMapsRouteUrl(
  points: { lat: number; lng: number }[]
): { url: string; omittedCount: number } | null {
  if (points.length < 2) return null;
  const middle = points.slice(1, -1);
  const waypoints =
    middle.length <= GOOGLE_MAPS_MAX_WAYPOINTS
      ? middle
      : Array.from(
          { length: GOOGLE_MAPS_MAX_WAYPOINTS },
          (_, i) =>
            middle[
              Math.round(
                (i * (middle.length - 1)) / (GOOGLE_MAPS_MAX_WAYPOINTS - 1)
              )
            ]
        );
  const fmt = (p: { lat: number; lng: number }) => `${p.lat},${p.lng}`;
  const params = new URLSearchParams({
    api: "1",
    origin: fmt(points[0]),
    destination: fmt(points[points.length - 1]),
  });
  if (waypoints.length > 0) {
    params.set("waypoints", waypoints.map(fmt).join("|"));
  }
  return {
    url: `https://www.google.com/maps/dir/?${params.toString()}`,
    omittedCount: middle.length - waypoints.length,
  };
}
