import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_ADMIN_ROLES } from "@/lib/types";

/**
 * 依頼を1つ削除する。**指し方は2通り** —— 修正の依頼はスポットのid
 * (スポット詳細の「依頼を取り消す」。依頼のidを知らない)、追加の依頼は
 * 依頼そのもののid(管理画面の一覧。指す先のスポットが無い)。
 * どちらもuuidなので取り違えは起きない。
 * 一覧からまとめて削除するのは DELETE /api/spot-flags?type= の方(idの配列で指す)。
 */
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
  // 既に取り消されていても成功で返す(トグルUI側での二重送信に強くする)
  await query("delete from spot_flags where spot_id = $1 or id = $1", [id]);
  return NextResponse.json({ data: { ok: true } });
}
