import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import type { VisitPlanList } from "@/lib/types";

/** 訪問予定リスト1件(経由スポットはseq順のspot_ids)。作成者本人のみ取得できる */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const { rows } = await query<VisitPlanList>(
    `select l.id, l.spot_type_id, l.title, l.description,
            to_char(l.start_date, 'YYYY-MM-DD') as start_date,
            to_char(l.end_date, 'YYYY-MM-DD') as end_date,
            l.created_at, l.updated_at,
            coalesce(
              array_agg(i.spot_id order by i.seq)
                filter (where i.spot_id is not null),
              '{}'
            ) as spot_ids
       from visit_plan_lists l
       left join visit_plan_list_items i on i.list_id = l.id
      where l.id = $1 and l.user_id = $2
      group by l.id`,
    [id, userId]
  );

  if (rows.length === 0) {
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

  // 経由スポット(visit_plan_list_items)はFKのon delete cascadeで一緒に消える
  const { rowCount } = await query(
    "delete from visit_plan_lists where id = $1 and user_id = $2",
    [id, userId]
  );
  if (!rowCount) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ data: { ok: true } });
}
