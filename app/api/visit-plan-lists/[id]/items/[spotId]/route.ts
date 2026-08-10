import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import type { VisitPlanList } from "@/lib/types";
import { PLAN_LIST_COLUMNS } from "@/lib/visitPlanListSql";

/**
 * 訪問予定リストの経由スポット1件の「訪問済み」(visited_at)を付け外しする。
 * 訪問記録を付けたときは POST /api/visits が自動で立てるが、記録するほどでもない
 * 立ち寄りや、誤って付けた分をここで手直しできる。
 *
 * 更新後のリストをそのまま返すので、呼び出し側は取り直さずに画面へ反映できる。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; spotId: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, spotId } = await params;

  const body = await request.json();
  if (typeof body?.visited !== "boolean") {
    return NextResponse.json(
      { error: "visited (boolean) は必須です。" },
      { status: 400 }
    );
  }

  // 本人のリストの経由スポットだけを更新する(他人のリストは404扱いで存在も伏せる)
  const { rowCount } = await query(
    `update visit_plan_list_items it
        set visited_at = case when $3 then now() else null end
       from visit_plan_lists l
      where it.list_id = l.id
        and l.id = $1 and l.user_id = $2 and it.spot_id = $4`,
    [id, userId, body.visited, spotId]
  );
  if (!rowCount) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { rows } = await query<VisitPlanList>(
    `select ${PLAN_LIST_COLUMNS}
       from visit_plan_lists l
       left join visit_plan_list_items i on i.list_id = l.id
      where l.id = $1 and l.user_id = $2
      group by l.id`,
    [id, userId]
  );
  return NextResponse.json({ data: rows[0] });
}
