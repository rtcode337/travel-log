import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_ADMIN_ROLES } from "@/lib/types";

/**
 * ルート1本の削除(経由地はFKのon delete cascadeで消える。スポット自体は消えない)。
 * 権限はスポットの削除と同じ: 公開ルートはspot_admin/admin、それ以外
 * (非公開・承認待ち・却下)は作成者本人のみ
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { rows } = await query<{ status: string; created_by: string | null }>(
    "select status, created_by from spot_routes where id = $1",
    [id]
  );
  const route = rows[0];
  if (!route) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const canDelete =
    route.status === "published"
      ? SPOT_ADMIN_ROLES.includes(user.role)
      : route.created_by === user.id;
  if (!canDelete) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  await query("delete from spot_routes where id = $1", [id]);
  return NextResponse.json({ data: { ok: true } });
}
