import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import type { VisitPlanList } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 指定リスト(本人)のspot_ids付き1件を返すSELECT(GET/PATCHの返却で共用) */
const LIST_SELECT = `
  select l.id, l.spot_type_id, l.title, l.description,
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
   group by l.id`;

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

  const { rows } = await query<VisitPlanList>(LIST_SELECT, [id, userId]);

  if (rows.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ data: rows[0] });
}

/** 訪問予定リストの内容(基本情報+経由スポット)を更新する。作成者本人のみ。
 * 経由スポットは受け取ったspot_idsで丸ごと置き換える(seqは並び順) */
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
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description =
    typeof body?.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;
  const startDate = body?.start_date;
  const endDate = body?.end_date || startDate;
  const spotIds: string[] = Array.isArray(body?.spot_ids)
    ? body.spot_ids.filter((s: unknown): s is string => typeof s === "string")
    : [];

  if (!title) {
    return NextResponse.json({ error: "title は必須です。" }, { status: 400 });
  }
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return NextResponse.json(
      { error: "訪問予定期間の日付が不正です。" },
      { status: 400 }
    );
  }
  if (endDate < startDate) {
    return NextResponse.json(
      { error: "終了日は開始日以降にしてください。" },
      { status: 400 }
    );
  }

  // 本人のリストであることを確認しつつ、経由スポットの絞り込み用に種別IDを得る
  const owned = await query<{ spot_type_id: string }>(
    "select spot_type_id from visit_plan_lists where id = $1 and user_id = $2",
    [id, userId]
  );
  const spotTypeId = owned.rows[0]?.spot_type_id;
  if (!spotTypeId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await query(
    `update visit_plan_lists
        set title = $1, description = $2, start_date = $3, end_date = $4
      where id = $5`,
    [title, description, startDate, endDate, id]
  );

  // 経由スポットは丸ごと置き換える(重複除去+その種別のスポットに限定)
  await query("delete from visit_plan_list_items where list_id = $1", [id]);
  const ordered = spotIds.filter((s, i) => spotIds.indexOf(s) === i);
  if (ordered.length > 0) {
    await query(
      `insert into visit_plan_list_items (list_id, spot_id, seq)
       select $1, s.id, ord.seq
       from unnest($2::uuid[]) with ordinality as ord(spot_id, seq)
       join spots s on s.id = ord.spot_id and s.spot_type_id = $3
       on conflict (list_id, spot_id) do nothing`,
      [id, ordered, spotTypeId]
    );
  }

  const { rows } = await query<VisitPlanList>(LIST_SELECT, [id, userId]);
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
