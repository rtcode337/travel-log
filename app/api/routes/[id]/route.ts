import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_ADMIN_ROLES } from "@/lib/types";

/** ルート1本の削除(経由地はFKのon delete cascadeで消える。スポット自体は消えない) */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!SPOT_ADMIN_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { id } = await params;
  const { rowCount } = await query("delete from spot_routes where id = $1", [id]);
  if (!rowCount) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ data: { ok: true } });
}
