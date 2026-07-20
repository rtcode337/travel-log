import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_ADMIN_ROLES } from "@/lib/types";

/**
 * SQLシード同期の並行実行等でできた重複スポットの後始末用API。
 * 重複の判定キーはシード同期(sync-sql)と同じ name + prefecture + municipality の
 * 完全一致(municipalityのnullと''は同一視)。対象はpublishedのみ —
 * private/pending/rejectedはユーザー個人のスポットや承認フロー中のものなので触らない。
 * 各グループで最初に登録された1件(created_atが最古、同時はidの小さい方)を残す。
 */
const DUPLICATE_GROUPS_SQL = `
  select array_agg(id order by created_at, id) as ids
  from spots
  where spot_type_id = $1 and status = 'published'
  group by name, prefecture, coalesce(municipality, '')
  having count(*) > 1`;

async function resolveSpotType(typeKey: string) {
  const { rows } = await query<{ id: string }>(
    "select id from spot_types where key = $1",
    [typeKey]
  );
  return rows[0] ?? null;
}

async function authorize() {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (!SPOT_ADMIN_ROLES.includes(user.role)) {
    return { error: NextResponse.json({ error: "権限がありません。" }, { status: 403 }) };
  }
  return { user };
}

/** 重複グループを確認する(プレビューのみ、DBは変更しない) */
export async function GET(request: Request) {
  const auth = await authorize();
  if (auth.error) return auth.error;

  const typeKey = new URL(request.url).searchParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const spotType = await resolveSpotType(typeKey);
  if (!spotType) {
    return NextResponse.json({ error: "存在しない種類です。" }, { status: 404 });
  }

  const { rows } = await query<{
    name: string;
    prefecture: string;
    municipality: string | null;
    count: number;
  }>(
    `select name, prefecture, min(municipality) as municipality, count(*)::int as count
     from spots
     where spot_type_id = $1 and status = 'published'
     group by name, prefecture, coalesce(municipality, '')
     having count(*) > 1
     order by prefecture, name`,
    [spotType.id]
  );
  const deleteCount = rows.reduce((sum, g) => sum + g.count - 1, 0);
  return NextResponse.json({
    data: { groupCount: rows.length, deleteCount, groups: rows },
  });
}

/** 重複グループごとに最初の1件を残して削除する。
 * 削除する行の訪問記録・訪問予定・口コミは残す1件に引き継ぐ */
export async function POST(request: Request) {
  const auth = await authorize();
  if (auth.error) return auth.error;

  const typeKey = new URL(request.url).searchParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const spotType = await resolveSpotType(typeKey);
  if (!spotType) {
    return NextResponse.json({ error: "存在しない種類です。" }, { status: 404 });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    // グループ数が多くても1文ずつで済むよう、残す1件(keep_id)と削除する行(dup_id)の
    // 対応表をトランザクション内の一時テーブルに作って各テーブルの付け替えに使い回す
    // (create table asはバインドパラメータを取れないユーティリティ文のため、空で作ってからinsertする)
    await client.query(
      "create temp table dedupe_map (keep_id uuid, dup_id uuid) on commit drop"
    );
    await client.query(
      `insert into dedupe_map (keep_id, dup_id)
       with groups as (${DUPLICATE_GROUPS_SQL})
       select ids[1], unnest(ids[2:]) from groups`,
      [spotType.id]
    );

    // visits・reviewsは同一ユーザー×同一スポットで複数件可なので、そのまま全件付け替える
    // (visitsを漏らさず移すことで、スポット削除のカスケードで写真ファイルが孤児化する事態も防ぐ)
    await client.query(
      "update visits v set spot_id = m.keep_id from dedupe_map m where v.spot_id = m.dup_id"
    );
    await client.query(
      "update reviews r set spot_id = m.keep_id from dedupe_map m where r.spot_id = m.dup_id"
    );
    // visit_plansは(user_id, spot_id)一意なので、残す側に同じユーザーの予定がまだ無い場合に
    // 限り、ユーザー×残す先ごとに1件だけ付け替える。付け替えなかった分は実質重複した予定
    // なので、スポット削除のカスケードで一緒に消える
    await client.query(
      `update visit_plans vp set spot_id = picked.keep_id
       from (
         select distinct on (p.user_id, m.keep_id) p.id, m.keep_id
         from visit_plans p
         join dedupe_map m on p.spot_id = m.dup_id
         where not exists (
           select 1 from visit_plans k
           where k.user_id = p.user_id and k.spot_id = m.keep_id
         )
         order by p.user_id, m.keep_id, p.created_at, p.id
       ) picked
       where vp.id = picked.id`
    );

    const { rowCount } = await client.query(
      "delete from spots s using dedupe_map m where s.id = m.dup_id"
    );
    await client.query("commit");
    return NextResponse.json({ data: { deletedCount: rowCount ?? 0 } });
  } catch (err) {
    await client.query("rollback").catch(() => {});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "dedupe failed" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
