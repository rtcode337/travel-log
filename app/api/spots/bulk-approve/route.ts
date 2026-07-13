import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_ADMIN_ROLES, type Spot } from "@/lib/types";

/** 承認待ちスポットをまとめて公開する(CSVインポート等でpendingが大量に溜まった場合用) */
export async function POST(request: Request) {
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
  const { rows: typeRows } = await query<{ id: string }>(
    "select id from spot_types where key = $1",
    [typeKey]
  );
  const spotType = typeRows[0];
  if (!spotType) {
    return NextResponse.json({ error: "存在しない種類です。" }, { status: 404 });
  }

  const { rows } = await query<Spot>(
    `update spots set status = 'published'
     where status = 'pending' and spot_type_id = $1
     returning *`,
    [spotType.id]
  );
  return NextResponse.json({ data: rows });
}
