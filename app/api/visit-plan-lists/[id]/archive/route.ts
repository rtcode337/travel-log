import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import type { VisitPlanList } from "@/lib/types";
import { PLAN_LIST_COLUMNS } from "@/lib/visitPlanListSql";

/**
 * 訪問予定リストのアーカイブを付け外しする(`archived_at`)。作成者本人のみ。
 *
 * **基本情報のPATCH(`/api/visit-plan-lists/[id]`)に相乗りさせない** ——
 * あちらは経由スポットを丸ごと置き換える仕様で、印を1つ立てたいだけの操作に
 * `spot_ids`まで送らせるのは事故のもと(送り忘れると経由スポットが全部消える)。
 * 経由スポットの訪問済み(`items/[spotId]`)と同じく、更新後のリストを返すので
 * 呼び出し側は取り直さずに画面へ反映できる。
 */
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
  if (typeof body?.archived !== "boolean") {
    return NextResponse.json(
      { error: "archived (boolean) は必須です。" },
      { status: 400 }
    );
  }

  // 本人のリストだけを更新する(他人のリストは404扱いで存在も伏せる)
  const { rowCount } = await query(
    `update visit_plan_lists
        set archived_at = case when $3 then now() else null end
      where id = $1 and user_id = $2`,
    [id, userId, body.archived]
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
