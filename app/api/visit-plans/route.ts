import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import type { VisitPlan } from "@/lib/types";

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const spotId = searchParams.get("spot_id");

  const { rows } = spotId
    ? await query<VisitPlan>(
        "select * from visit_plans where user_id = $1 and spot_id = $2",
        [userId, spotId]
      )
    : await query<VisitPlan>(
        "select * from visit_plans where user_id = $1 order by created_at desc",
        [userId]
      );

  return NextResponse.json({ data: rows });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { spot_id } = await request.json();
  if (typeof spot_id !== "string") {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  // 既に訪問予定に入っていても同じ結果を返す(トグルUI側での二重送信に強くする)
  const { rows } = await query<VisitPlan>(
    `insert into visit_plans (user_id, spot_id)
     values ($1, $2)
     on conflict (user_id, spot_id) do update set user_id = excluded.user_id
     returning *`,
    [userId, spot_id]
  );
  return NextResponse.json({ data: rows[0] });
}
