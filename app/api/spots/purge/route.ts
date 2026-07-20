import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteVisitPhotos } from "@/lib/photos";

async function resolveSpotType(typeKey: string) {
  const { rows } = await query<{ id: string }>(
    "select id from spot_types where key = $1",
    [typeKey]
  );
  return rows[0] ?? null;
}

/**
 * スポット種別ごと一括削除。CSVで作り直す前提の強い操作で、published以外
 * (private/pending/rejected)の他ユーザー分も巻き込んで消すため、ユーザー管理と
 * 同様にadmin専用とする(spot_adminは不可)。
 */
async function authorize() {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (user.role !== "admin") {
    return { error: NextResponse.json({ error: "権限がありません。" }, { status: 403 }) };
  }
  return { user };
}

/** 削除対象件数を確認する(プレビューのみ、DBは変更しない) */
export async function GET(request: Request) {
  const auth = await authorize();
  if (auth.error) return auth.error;

  const typeKey = new URL(request.url).searchParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const spotType = await resolveSpotType(typeKey);
  if (!spotType) {
    return NextResponse.json({ error: "存在しない種別です。" }, { status: 404 });
  }

  const { rows } = await query<{ count: string }>(
    "select count(*) from spots where spot_type_id = $1",
    [spotType.id]
  );
  return NextResponse.json({ data: { count: Number(rows[0].count) } });
}

/**
 * 対象スポット種別のスポットをstatus問わず全件削除する。visits/visit_plans/reviewsは
 * spotsへのFKがon delete cascadeのため自動で消える(db/init/01_schema.sql参照)。
 * 写真ファイルはカスケードで行が消える前に集めておき、削除成功後にまとめて消す。
 */
export async function POST(request: Request) {
  const auth = await authorize();
  if (auth.error) return auth.error;

  const typeKey = new URL(request.url).searchParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const spotType = await resolveSpotType(typeKey);
  if (!spotType) {
    return NextResponse.json({ error: "存在しない種別です。" }, { status: 404 });
  }

  const client = await pool.connect();
  let photoRows: { photos: string[] }[] = [];
  let deletedCount = 0;
  try {
    await client.query("begin");
    const photoResult = await client.query<{ photos: string[] }>(
      `select v.photos from visits v
       join spots s on v.spot_id = s.id
       where s.spot_type_id = $1`,
      [spotType.id]
    );
    photoRows = photoResult.rows;
    const { rowCount } = await client.query(
      "delete from spots where spot_type_id = $1",
      [spotType.id]
    );
    deletedCount = rowCount ?? 0;
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "purge failed" },
      { status: 500 }
    );
  } finally {
    client.release();
  }

  await deleteVisitPhotos(photoRows.flatMap((r) => r.photos));
  return NextResponse.json({ data: { deletedCount } });
}
