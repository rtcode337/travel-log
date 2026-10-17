/**
 * 緯度・経度の入力の検査と、近さの計算(画面とAPIの両方で使う純粋な関数)。
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** 緯度・経度として成り立つ数か(範囲外・NaN・文字列は弾く) */
export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/**
 * 空でもよい座標の組を検査する(訪問記録の「行った場所」)。
 *
 * - **両方null(か未指定)は「指していない」**=スポットの位置として扱う
 * - 片方だけは受け付けない —— 緯度だけ残ると、どこを指すのか決まらない
 * - 範囲外・数でない値も受け付けない
 */
export function parseOptionalLatLng(
  lat: unknown,
  lng: unknown
): { ok: true; value: LatLng | null } | { ok: false; error: string } {
  if (lat == null && lng == null) return { ok: true, value: null };
  if (lat == null || lng == null) {
    return { ok: false, error: "緯度と経度は両方そろえて送ってください。" };
  }
  if (!isValidLatLng(lat, lng)) {
    return {
      ok: false,
      error: "緯度は-90〜90、経度は-180〜180の数で送ってください。",
    };
  }
  return { ok: true, value: { lat: lat as number, lng: lng as number } };
}

/** 2点間の距離(m)。近くのスポットを並べる・範囲を決めるための目安なので球面で足りる */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 中心から半径`radiusM`(m)の円を囲む緯度経度の範囲(南・西・北・東)。
 * 近くのスポットをSQLの範囲検索で引くのに使う(円で切るのは引いたあと)。
 * 極に近いと経度方向の幅が発散するので、緯度の余弦に下限を付けてある
 */
export function boundingBox(
  center: LatLng,
  radiusM: number
): { south: number; west: number; north: number; east: number } {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)));
  return {
    south: Math.max(-90, center.lat - dLat),
    north: Math.min(90, center.lat + dLat),
    west: center.lng - dLng,
    east: center.lng + dLng,
  };
}

/** 距離の表示(「35m」「1.2km」) */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}
