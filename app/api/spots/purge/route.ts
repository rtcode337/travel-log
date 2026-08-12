import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteVisitPhotos } from "@/lib/photos";

// 大量のスポット・写真を1リクエストで捌くため、既定(10秒)では足りない
// (Vercelのサーバーレス関数の上限。指定の無いホストでは無視される)
export const maxDuration = 60;

async function resolveSpotType(typeKey: string) {
  const { rows } = await query<{ id: string }>(
    "select id from spot_types where key = $1",
    [typeKey]
  );
  return rows[0] ?? null;
}

/**
 * スポット種別ごとの公開スポット一括削除。CSVで作り直す前提の強い操作で、
 * 対象は公開(published)スポットのみ(承認待ち・却下・非公開は残す)だが、
 * 公開スポットに紐づく全ユーザーの訪問記録・写真等を巻き込んで消すため、
 * ユーザー管理と同様にadmin専用とする(spot_adminは不可)。
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
    "select count(*) from spots where spot_type_id = $1 and status = 'published'",
    [spotType.id]
  );
  return NextResponse.json({ data: { count: Number(rows[0].count) } });
}

/**
 * 対象スポット種別の公開(published)スポットを全件削除する(承認待ち・却下・
 * 非公開は残す)。visits/visit_plans/reviewsはspotsへのFKがon delete cascadeの
 * ため自動で消える(db/init/01_schema.sql参照)。写真ファイルはカスケードで
 * 行が消える前に集めておき、削除成功後にまとめて消す。
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
       where s.spot_type_id = $1 and s.status = 'published'`,
      [spotType.id]
    );
    photoRows = photoResult.rows;
    // ルートはスポットのカスケードでは経由地しか消えないため、空のルートが
    // 残らないようここで明示的に消す(ルートはCSV由来のシードデータで、経由地は
    // 公開スポットの前提。CSVで作り直す前提の操作のため丸ごとでよい)
    await client.query("delete from spot_routes where spot_type_id = $1", [
      spotType.id,
    ]);
    const { rowCount } = await client.query(
      "delete from spots where spot_type_id = $1 and status = 'published'",
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
