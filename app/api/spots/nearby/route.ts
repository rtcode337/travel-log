import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { boundingBox, distanceMeters, isValidLatLng } from "@/lib/coords";
import { MODERATION_ROLES, SPOT_ADMIN_ROLES, type NearbySpot } from "@/lib/types";

/** 既定の半径(m)。座標を指す地図を開いたときの拡大率(18)で、画面の外まで少し届く広さ */
const DEFAULT_RADIUS_M = 300;
/** 半径の上限(m)。広く取ると件数が膨らむうえ、建物に重ねる用途には要らない */
const MAX_RADIUS_M = 1000;
/** 返す件数の上限。地図の点と一覧のためなので、近い順にこれだけあれば足りる */
const MAX_RESULTS = 150;

/**
 * 座標の近くにあるスポット(**種別をまたいで**、ユーザーが見られる全種別)。
 *
 * 座標を指す地図(訪問記録の「行った場所」・位置の報告/修正)で、同じ建物に入っている
 * 店にピンを重ねる(吸着)ために使う。地図の公開スポットのキャッシュは種別ごとで、
 * ダウンロードしていない種別は手元に無いため、サーバーで引く。
 *
 * - 見える範囲はGET /api/spotsと同じ: 種別は一般公開のもの(admin/spot_adminは全種別)、
 *   スポットは公開か本人が作ったもの(moderator以上は承認待ち・却下も)
 * - 自分が非表示にしたスポット(spot_hides)は出さない(地図・一覧と同じ扱い)
 * - `lat`/`lng`の周りの矩形を`spots_lat_lng_idx`で引き、円で切って近い順に返す
 * - `exclude`に渡したスポット(位置を直している当のスポット)は除く
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  if (!searchParams.get("lat") || !searchParams.get("lng") || !isValidLatLng(lat, lng)) {
    return NextResponse.json({ error: "invalid lat/lng" }, { status: 400 });
  }
  const radius = Math.min(
    MAX_RADIUS_M,
    Math.max(1, Number(searchParams.get("radius")) || DEFAULT_RADIUS_M)
  );
  // UUIDの形でなければ無視する(そのままSQLへ渡すと型の変換で500になる)
  const excludeParam = searchParams.get("exclude");
  const exclude =
    excludeParam && /^[0-9a-f-]{36}$/i.test(excludeParam) ? excludeParam : null;
  const box = boundingBox({ lat, lng }, radius);

  const statusCondition = MODERATION_ROLES.includes(user.role)
    ? "(s.status != 'private' or s.created_by = $1)"
    : "(s.status = 'published' or s.created_by = $1)";
  // 一般公開でない種別は、admin/spot_adminにしか存在を見せない(GET /api/spotsと同じ)
  const typeCondition = SPOT_ADMIN_ROLES.includes(user.role)
    ? "true"
    : `exists (select 1 from spot_type_settings ts
                where ts.spot_type_id = s.spot_type_id
                  and ts.key = 'public_visible' and ts.value = 'true')`;

  const { rows } = await query<NearbySpot>(
    `select s.id, s.name, s.lat, s.lng, t.key as type_key, t.label as type_label
       from spots s
       join spot_types t on t.id = s.spot_type_id
      where s.lat between $2 and $3
        and s.lng between $4 and $5
        and ${statusCondition}
        and ${typeCondition}
        and not exists (select 1 from spot_hides h where h.user_id = $1 and h.spot_id = s.id)
        and ($6::uuid is null or s.id <> $6::uuid)`,
    [user.id, box.south, box.north, box.west, box.east, exclude]
  );

  // 矩形の角は半径の外なので円で切り、近い順に並べる(並べ替えは件数の少ない手元で)
  const data = rows
    .map((row) => ({ row, d: distanceMeters({ lat, lng }, row) }))
    .filter(({ d }) => d <= radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_RESULTS)
    .map(({ row }) => row);
  return NextResponse.json({ data });
}
