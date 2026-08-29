import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_ADMIN_ROLES } from "@/lib/types";

/**
 * 報告を1つ取り消す(スポット詳細の「報告を取り消す」)。
 * 一覧からまとめて取り消すのは DELETE /api/spot-flags?type= の方。
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ spotId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!SPOT_ADMIN_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { spotId } = await params;
  // 既に取り消されていても成功で返す(トグルUI側での二重送信に強くする)
  await query("delete from spot_flags where spot_id = $1", [spotId]);
  return NextResponse.json({ data: { ok: true } });
}
