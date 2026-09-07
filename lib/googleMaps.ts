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
 *
 * **出発地(origin)は現在地**で、スポットは最後の1件が目的地(destination)、
 * それ以外が経由地(waypoints)になる(先頭のスポットを出発地にすると、
 * 今いる場所からそこまでの経路が出ないため)。originがnull=現在地が
 * 取れなかったときはoriginを付けずに開き、Google マップ側の判断
 * (多くの場合は「現在地」)に委ねる。
 *
 * 経由地が上限(GOOGLE_MAPS_MAX_WAYPOINTS)を超えるときは、経路の形をなるべく
 * 保つよう並び順のまま等間隔に間引き、省いた件数をomittedCountで返す
 * (呼び出し側が注記を出す)。スポットが0件のときは経路にならないためnull
 */
export function buildGoogleMapsRouteUrl(
  points: { lat: number; lng: number }[],
  origin?: { lat: number; lng: number } | null
): { url: string; omittedCount: number } | null {
  if (points.length < 1) return null;
  const middle = points.slice(0, -1);
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
    destination: fmt(points[points.length - 1]),
  });
  if (origin) {
    params.set("origin", fmt(origin));
  }
  if (waypoints.length > 0) {
    params.set("waypoints", waypoints.map(fmt).join("|"));
  }
  return {
    url: `https://www.google.com/maps/dir/?${params.toString()}`,
    omittedCount: middle.length - waypoints.length,
  };
}

/**
 * **候補の座標と、店名で引いた本物の場所を1枚の地図に並べて見比べるURL。**
 *
 * 経路検索(`dir`)の**出発地に座標・目的地に店名**を入れる。検索(`search`)は
 * 問い合わせを1つしか受け取れないので、2つの地点を同時に出すにはこの形になる。
 * 副産物として**ずれが距離として読める** —— 同じ場所なら数十m以内、違う場所を
 * 指していれば数百m〜数kmと出るので、目で見比べるより判断が速い。
 *
 * `travelmode=walking`にしてあるのは、短い距離を分単位・メートル単位で出すため
 * (車だと一方通行で遠回りの数字になり、ずれの大きさとして読めない)。
 *
 * **店名の側に座標を足さない。** 足すとGoogle側がその座標に寄せて解決するので、
 * 座標が間違っていても「合っている」ように見えて確かめる意味が無くなる
 * (手掛かりとして渡すのは住所か地域名までにとどめる)。
 */
export function buildGoogleMapsCompareUrl(
  point: { lat: number; lng: number },
  name: string,
  near?: string | null
): string {
  const origin = `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
  const destination = [name, near].filter((v): v is string => !!v && v.trim() !== "").join(" ");
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "walking",
  });
  return `https://www.google.com/maps/dir/?${params}`;
}
