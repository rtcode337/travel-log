import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import type { VisitPlanList } from "@/lib/types";
import { PLAN_LIST_COLUMNS, parsePlanSpotIds } from "@/lib/visitPlanListSql";
import { normalizePlanDates } from "@/lib/visitPlanListDates";

/** 指定リスト(本人)のspot_ids付き1件を返すSELECT(GET/PATCHの返却で共用) */
const LIST_SELECT = `
  select ${PLAN_LIST_COLUMNS}
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
  // 日付は未指定なら「訪問日未定」(両方null)。終了日だけの指定は断る
  const dates = normalizePlanDates(body ?? {});
  const ordered = parsePlanSpotIds(body?.spot_ids);

  if (!title) {
    return NextResponse.json({ error: "title は必須です。" }, { status: 400 });
  }
  if (!ordered) {
    return NextResponse.json({ error: "spot_ids が不正です。" }, { status: 400 });
  }
  if (!dates.ok) {
    return NextResponse.json({ error: dates.error }, { status: 400 });
  }

  // 本人のリストであることを確認する(存在しなければ404)
  const owned = await query<{ spot_type_id: string }>(
    "select spot_type_id from visit_plan_lists where id = $1 and user_id = $2",
    [id, userId]
  );
  const spotTypeId = owned.rows[0]?.spot_type_id;
  if (!spotTypeId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // 基本情報の更新と経由スポットの入れ替えは1つのトランザクションにする。
  // 別々に流すと、削除のあとで失敗したとき経由スポットが全部消えたまま残る
  // (同時に2本のPATCHが来たときに並びが混ざるのも防ぐ)
  const client = await pool.connect();
  try {
    await client.query("begin");
    // 同じリストへのPATCHを順番に通す(控えた訪問済みが別のPATCHの入れ替えで古くならないように)
    await client.query(
      "select id from visit_plan_lists where id = $1 for update",
      [id]
    );
    await client.query(
      `update visit_plan_lists
          set title = $1, description = $2, start_date = $3, end_date = $4
        where id = $5`,
      [title, description, dates.start, dates.end, id]
    );

    // 経由スポットは丸ごと置き換える(重複除去+存在するスポットに限定)。
    // 地図で別スポット種別を重ねて追加できるため種別は問わない(itemsテーブルも種別非依存)。
    // 置き換えで行が作り直されるため、訪問済み(visited_at)は先に控えて後で戻す
    // —— 戻さないと、リストの並び替えやタイトルの編集をしただけで訪問済みが消える
    const before = await client.query<{ spot_id: string; visited_at: string | null }>(
      "select spot_id, visited_at from visit_plan_list_items where list_id = $1",
      [id]
    );
    await client.query("delete from visit_plan_list_items where list_id = $1", [id]);
    if (ordered.length > 0) {
      await client.query(
        `insert into visit_plan_list_items (list_id, spot_id, seq)
         select $1, s.id, ord.seq
         from unnest($2::uuid[]) with ordinality as ord(spot_id, seq)
         join spots s on s.id = ord.spot_id
         on conflict (list_id, spot_id) do nothing`,
        [id, ordered]
      );
      const visited = before.rows.filter((r) => r.visited_at !== null);
      if (visited.length > 0) {
        await client.query(
          `update visit_plan_list_items it
              set visited_at = v.visited_at
             from unnest($2::uuid[], $3::timestamptz[]) as v(spot_id, visited_at)
            where it.list_id = $1 and it.spot_id = v.spot_id`,
          [id, visited.map((r) => r.spot_id), visited.map((r) => r.visited_at)]
        );
      }
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
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
