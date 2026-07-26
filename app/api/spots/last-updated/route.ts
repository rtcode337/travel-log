import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSpotTypeSetting, SPOT_ADMIN_ROLES, type SpotType } from "@/lib/types";
import { SPOT_TYPE_SELECT } from "@/lib/spot-types-query";

/**
 * ダウンロード済み公開スポットキャッシュの鮮度チェック用の軽量エンドポイント。
 * 指定種別の公開(published)スポット・公開ルートの最新updated_atと件数だけを返す
 * (地図を開いたときに全件を取り直さずに「キャッシュが古いか」を判定するため。
 * 件数も返すのは、削除だけが起きた場合はmax(updated_at)が変わらないため)。
 * 認可の扱いはGET /api/spotsと同じ
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const typeKey = new URL(request.url).searchParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const { rows: typeRows } = await query<SpotType>(
    `${SPOT_TYPE_SELECT} where t.key = $1`,
    [typeKey]
  );
  const activeType = typeRows[0];
  if (
    !activeType ||
    (!getSpotTypeSetting(activeType, "public_visible") && !SPOT_ADMIN_ROLES.includes(user.role))
  ) {
    return NextResponse.json({ error: "存在しない種別です。" }, { status: 404 });
  }

  // ルートの経由地(spot_route_points)の入れ替えは親のspot_routesがupsertで
  // 必ずUPDATEされる(updated_atが進む)ため、ここでは親テーブルだけ見れば足りる
  const { rows } = await query<{
    latest: string | null;
    spot_count: string;
    route_count: string;
  }>(
    `select
       greatest(
         (select max(updated_at) from spots where spot_type_id = $1 and status = 'published'),
         (select max(updated_at) from spot_routes where spot_type_id = $1 and status = 'published')
       ) as latest,
       (select count(*) from spots where spot_type_id = $1 and status = 'published') as spot_count,
       (select count(*) from spot_routes where spot_type_id = $1 and status = 'published') as route_count`,
    [activeType.id]
  );
  const row = rows[0];
  return NextResponse.json({
    data: {
      latest: row.latest,
      spotCount: Number(row.spot_count),
      routeCount: Number(row.route_count),
    },
  });
}
