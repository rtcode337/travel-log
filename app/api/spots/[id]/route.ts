import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteVisitPhotos } from "@/lib/photos";
import { MODERATION_ROLES, SPOT_ADMIN_ROLES, type Role, type Spot } from "@/lib/types";

/**
 * 閲覧できるのは「公開スポット」「本人が追加したスポット(status問わず)」、
 * 加えてmoderator以上は承認待ち・却下も本人以外の分を含めて閲覧できる。
 * 非公開は常に本人のみ(role問わず)。
 */
function canView(user: { id: string; role: Role }, spot: Spot): boolean {
  if (spot.status === "published") return true;
  if (spot.created_by === user.id) return true;
  if (spot.status === "private") return false;
  return MODERATION_ROLES.includes(user.role);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { rows } = await query<Spot>("select * from spots where id = $1", [id]);
  const spot = rows[0];
  if (spot && !canView(user, spot)) {
    return NextResponse.json({ data: null });
  }
  return NextResponse.json({ data: spot ?? null });
}

/**
 * 編集・削除できるのは、
 * - 公開スポット: admin/spot_adminのみ(投稿者本人かどうかは問わない)
 * - それ以外(非公開・承認待ち・却下): 追加した本人のみ(roleは問わない)
 */
async function canEditOrDelete(
  user: { id: string; role: Role },
  id: string
): Promise<boolean> {
  const { rows } = await query<{ status: string; created_by: string | null }>(
    "select status, created_by from spots where id = $1",
    [id]
  );
  const spot = rows[0];
  if (!spot) return false;
  if (spot.status === "published") return SPOT_ADMIN_ROLES.includes(user.role);
  return spot.created_by === user.id;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await canEditOrDelete(user, id))) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const spot = await request.json();

  const { rows } = await query<Spot>(
    `update spots set
      name = $1, name_kana = $2, prefecture = $3, municipality = $4,
      lat = $5, lng = $6, rank = $7, category = $8, description = $9, official_url = $10
     where id = $11
     returning *`,
    [
      spot.name,
      spot.name_kana,
      spot.prefecture,
      spot.municipality,
      spot.lat,
      spot.lng,
      spot.rank,
      spot.category,
      spot.description,
      spot.official_url,
      id,
    ]
  );

  return NextResponse.json({ data: rows[0] ?? null });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!(await canEditOrDelete(user, id))) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  // スポット削除はvisitsへカスケードするため、先に全ユーザー分の写真パスを
  // 集めておき、削除成功後にファイルも消す(孤児ファイルを残さない)
  const { rows: photoRows } = await query<{ photos: string[] }>(
    "select photos from visits where spot_id = $1",
    [id]
  );
  await query("delete from spots where id = $1", [id]);
  await deleteVisitPhotos(photoRows.flatMap((r) => r.photos));
  return NextResponse.json({ ok: true });
}
