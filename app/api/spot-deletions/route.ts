import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_ADMIN_ROLES, type SpotDeletion, type SpotType } from "@/lib/types";
import { SPOT_TYPE_SELECT } from "@/lib/spot-types-query";

/**
 * 種別の「削除の墓標」(画面から個別削除されたCSV由来の公開スポットの記録)一覧。
 * travel-log-dataへの還元用エクスポート(/[type]/admin)がexclude.txtへの
 * 追記候補として使う。エクスポートと同じくspot_admin/adminのみ
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!SPOT_ADMIN_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const typeKey = new URL(request.url).searchParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const { rows: typeRows } = await query<SpotType>(
    `${SPOT_TYPE_SELECT} where t.key = $1`,
    [typeKey]
  );
  const spotType = typeRows[0];
  if (!spotType) {
    return NextResponse.json({ error: "存在しない種別です。" }, { status: 404 });
  }

  const { rows } = await query<SpotDeletion>(
    `select id, spot_type_id, key, name, lat, lng, region, deleted_by, created_at
       from spot_deletions
      where spot_type_id = $1
      order by created_at`,
    [spotType.id]
  );
  return NextResponse.json({ data: rows });
}
