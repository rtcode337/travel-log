import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import type { VisitPlanList } from "@/lib/types";
import { PLAN_LIST_COLUMNS } from "@/lib/visitPlanListSql";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 現在のユーザーの、指定スポット種別の訪問予定リスト一覧。各リストの経由スポットは
 * seq順の spot_ids(UUID配列)として返す(スポットの詳細は呼び出し側が保持済みの
 * 一覧から解決する)。訪問済みの経由スポットは spot_ids に残したまま
 * visited_spot_ids にも入る。
 */
export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const typeKey = searchParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }

  const { rows } = await query<VisitPlanList>(
    `select ${PLAN_LIST_COLUMNS}
       from visit_plan_lists l
       left join visit_plan_list_items i on i.list_id = l.id
      where l.user_id = $1
        and l.spot_type_id = (select id from spot_types where key = $2)
      group by l.id
      order by l.start_date desc, l.created_at desc`,
    [userId, typeKey]
  );

  return NextResponse.json({ data: rows });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const type = body?.type;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description =
    typeof body?.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;
  const startDate = body?.start_date;
  // 終了日が空なら開始日と同じ(=単日)にする
  const endDate = body?.end_date || startDate;
  const spotIds: string[] = Array.isArray(body?.spot_ids)
    ? body.spot_ids.filter((s: unknown): s is string => typeof s === "string")
    : [];

  if (typeof type !== "string" || !title) {
    return NextResponse.json(
      { error: "type と title は必須です。" },
      { status: 400 }
    );
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

  const typeRow = await query<{ id: string }>(
    "select id from spot_types where key = $1",
    [type]
  );
  const spotTypeId = typeRow.rows[0]?.id;
  if (!spotTypeId) {
    return NextResponse.json(
      { error: "スポット種別が見つかりません。" },
      { status: 400 }
    );
  }

  const { rows } = await query<{ id: string }>(
    `insert into visit_plan_lists
       (user_id, spot_type_id, title, description, start_date, end_date)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [userId, spotTypeId, title, description, startDate, endDate]
  );
  const listId = rows[0].id;

  // 重複を除いた並び順のままseqを振って経由スポットを登録する。
  // 存在するスポットだけを入れる(defensive)。地図で別スポット種別を重ねて追加できる
  // ため種別は問わない(itemsテーブルも種別非依存。リスト自体のspot_type_idは所属の目印)
  const ordered = spotIds.filter((s, i) => spotIds.indexOf(s) === i);
  if (ordered.length > 0) {
    await query(
      `insert into visit_plan_list_items (list_id, spot_id, seq)
       select $1, s.id, ord.seq
       from unnest($2::uuid[]) with ordinality as ord(spot_id, seq)
       join spots s on s.id = ord.spot_id
       on conflict (list_id, spot_id) do nothing`,
    [listId, ordered]
    );
  }

  const created = await query<VisitPlanList>(
    `select ${PLAN_LIST_COLUMNS}
       from visit_plan_lists l
       left join visit_plan_list_items i on i.list_id = l.id
      where l.id = $1
      group by l.id`,
    [listId]
  );

  return NextResponse.json({ data: created.rows[0] });
}
