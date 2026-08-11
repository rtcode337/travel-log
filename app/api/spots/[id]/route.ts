import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteVisitPhotos } from "@/lib/photos";
import { MODERATION_ROLES, SPOT_ADMIN_ROLES, type Role, type Spot } from "@/lib/types";
import { parseRank } from "@/lib/rank";

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

  // keyはボディに含まれるときだけ更新する(編集フォーム等、keyを扱わない既存の
  // 呼び出し元が送る部分的なボディで、CSV由来のkeyがnullに消されないように)
  const hasKey = Object.prototype.hasOwnProperty.call(spot, "key");
  // categoriesもkeyと同じ理由でボディに含まれるときだけ更新する(「カテゴリなし」は
  // 空配列を明示的に送る。省略との区別がつかないと部分的なボディで全消しになるため)
  const hasCategories = Object.prototype.hasOwnProperty.call(spot, "categories");
  // origin(登録経路)もボディに含まれるときだけ更新する。CSVインポートの上書きが
  // 一致した行を'csv'(還元済み)に倒すための項目で、変更はspot_admin/adminに限る
  const hasOrigin = Object.prototype.hasOwnProperty.call(spot, "origin");
  if (hasOrigin) {
    if (spot.origin !== "csv" && spot.origin !== "manual") {
      return NextResponse.json(
        { error: `origin「${spot.origin}」は指定できません。` },
        { status: 400 }
      );
    }
    if (!SPOT_ADMIN_ROLES.includes(user.role)) {
      return NextResponse.json(
        { error: "originを変更する権限がありません。" },
        { status: 403 }
      );
    }
  }
  const { rows } = await query<Spot>(
    `update spots set
      name = $1, name_kana = $2, lat = $3, lng = $4, region = $5,
      series = $6, description = $7, rank = $15,
      categories = case when $8 then $9::text[] else categories end,
      key = case when $10 then $11 else key end,
      origin = case when $12 then $13 else origin end
     where id = $14
     returning *`,
    [
      spot.name,
      spot.name_kana,
      spot.lat,
      spot.lng,
      spot.region,
      spot.series,
      spot.description,
      hasCategories,
      hasCategories ? (spot.categories ?? []) : [],
      hasKey,
      hasKey ? spot.key : null,
      hasOrigin,
      hasOrigin ? spot.origin : null,
      id,
      parseRank(spot.rank),
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
  // CSV由来の公開スポットの個別削除は「削除の墓標」に記録し、travel-log-data側の
  // exclude.txtへ追記する候補として還元用エクスポートに出す(手動追加(manual)は
  // travel-log-data側に元の行が無いため記録不要。purge等の一括削除はこのAPIを
  // 通らないため記録されない — travel-log-data側発の操作なのでそれで正しい)
  await query(
    `insert into spot_deletions (spot_type_id, key, name, lat, lng, region, deleted_by)
     select spot_type_id, key, name, lat, lng, region, $2
       from spots where id = $1 and status = 'published' and origin = 'csv'`,
    [id, user.id]
  );
  await query("delete from spots where id = $1", [id]);
  await deleteVisitPhotos(photoRows.flatMap((r) => r.photos));
  return NextResponse.json({ ok: true });
}
