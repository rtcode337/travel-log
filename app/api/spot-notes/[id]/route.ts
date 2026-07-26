import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import type { SpotNote } from "@/lib/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const memo = typeof body.memo === "string" ? body.memo.trim() : "";
  if (!memo) {
    return NextResponse.json({ error: "メモを入力してください。" }, { status: 400 });
  }

  // 編集できるのは自分の未訪問記録のみ
  const { rows } = await query<SpotNote>(
    `update spot_notes set noted_on = $1, memo = $2
     where id = $3 and user_id = $4
     returning *`,
    [body.noted_on ?? null, memo, id, userId]
  );
  if (!rows[0]) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ data: rows[0] });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await query("delete from spot_notes where id = $1 and user_id = $2", [
    id,
    userId,
  ]);
  return NextResponse.json({ ok: true });
}
