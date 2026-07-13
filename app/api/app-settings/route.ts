import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser, getCurrentUserId } from "@/lib/auth/current-user";
import type { SpotType } from "@/lib/types";

/**
 * ここで返す/更新する値は「ログイン後に自動で開くスポット種類の既定値」のみ。
 * 地図・一覧・スポットAPIの対象種類はURLキー(/[type]/...)で必ず指定するため、
 * この値では絞り込まない。
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { rows } = await query<SpotType>(
    `select t.* from app_settings s
     join spot_types t on t.id = s.active_spot_type_id`
  );
  return NextResponse.json({ data: rows[0] ?? null });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { spot_type_id } = await request.json();
  if (typeof spot_type_id !== "string") {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { rows: typeRows } = await query<SpotType>(
    "select * from spot_types where id = $1",
    [spot_type_id]
  );
  if (!typeRows[0]) {
    return NextResponse.json({ error: "存在しない種類です。" }, { status: 400 });
  }

  await query(
    "update app_settings set active_spot_type_id = $1, updated_at = now()",
    [spot_type_id]
  );
  return NextResponse.json({ data: typeRows[0] });
}
