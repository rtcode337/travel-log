import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ spotId: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { spotId } = await params;
  await query("delete from visit_plans where user_id = $1 and spot_id = $2", [
    userId,
    spotId,
  ]);
  return NextResponse.json({ ok: true });
}
