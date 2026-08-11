import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { MODERATION_ROLES, SPOT_ADMIN_ROLES, type Role } from "@/lib/types";
import type { MyReview, PublicReview, Review } from "@/lib/types";

const PAGE_SIZE = 10;

/**
 * 口コミの閲覧可否をスポット本体の可視性に合わせる(spots/[id]/route.tsのcanViewと同じ
 * 考え方)。spot_idはUUIDで推測されにくいとはいえ、それだけを根拠に非公開スポット・
 * 非公開種別の口コミを晒さないための認可チェック。
 */
function canViewReviews(
  user: { id: string; role: Role },
  spot: { status: string; created_by: string | null; type_public_visible: boolean }
): boolean {
  if (!spot.type_public_visible && !SPOT_ADMIN_ROLES.includes(user.role)) return false;
  if (spot.status === "published") return true;
  if (spot.created_by === user.id) return true;
  if (spot.status === "private") return false;
  return MODERATION_ROLES.includes(user.role);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  // mine=1: 自分が書いた口コミを、投稿先スポットの情報付きで新しい順に全件返す
  // (一覧画面のトップで使うため、visits/visitPlansと同様にページングはクライアント側で行う)
  if (searchParams.get("mine") === "1") {
    const typeKey = searchParams.get("type");
    if (!typeKey) {
      return NextResponse.json({ error: "type is required" }, { status: 400 });
    }
    const { rows: typeRows } = await query<{ id: string }>(
      "select id from spot_types where key = $1",
      [typeKey]
    );
    if (!typeRows[0]) {
      return NextResponse.json({ error: "存在しない種別です。" }, { status: 404 });
    }
    const { rows } = await query<MyReview>(
      `select r.id, r.spot_id, r.body, r.created_at,
         s.name as spot_name, s.region as spot_region, s.series as spot_series,
         s.rank as spot_rank
       from reviews r
       join spots s on s.id = r.spot_id
       where r.user_id = $1 and s.spot_type_id = $2
       order by r.created_at desc`,
      [user.id, typeRows[0].id]
    );
    return NextResponse.json({ data: rows });
  }

  const spotId = searchParams.get("spot_id");
  if (!spotId) {
    return NextResponse.json({ error: "spot_id is required" }, { status: 400 });
  }

  const { rows: spotRows } = await query<{
    status: string;
    created_by: string | null;
    type_public_visible: boolean;
  }>(
    `select s.status, s.created_by,
       coalesce(
         (select value from spot_type_settings
          where spot_type_id = s.spot_type_id and key = 'public_visible'),
         'false'
       ) = 'true' as type_public_visible
     from spots s
     where s.id = $1`,
    [spotId]
  );
  const spot = spotRows[0];
  if (!spot || !canViewReviews(user, spot)) {
    return NextResponse.json({ error: "存在しないスポットです。" }, { status: 404 });
  }

  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const [{ rows }, { rows: countRows }] = await Promise.all([
    query<PublicReview>(
      `select r.id, r.body, r.created_at, coalesce(nullif(u.nickname, ''), '匿名') as user_name
       from reviews r
       join users u on u.id = r.user_id
       where r.spot_id = $1 and r.visibility = 'public'
       order by r.created_at desc
       limit $2 offset $3`,
      [spotId, PAGE_SIZE, (page - 1) * PAGE_SIZE]
    ),
    query<{ count: string }>(
      `select count(*) from reviews where spot_id = $1 and visibility = 'public'`,
      [spotId]
    ),
  ]);

  return NextResponse.json({
    data: { items: rows, total: Number(countRows[0].count) },
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = user.id;

  const { spot_id, body } = await request.json();
  if (typeof spot_id !== "string" || typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { rows: spotRows } = await query<{
    reviews_enabled: string | null;
    status: string;
  }>(
    `select
       (select value from spot_type_settings
        where spot_type_id = s.spot_type_id and key = 'reviews_enabled') as reviews_enabled,
       s.status
     from spots s
     where s.id = $1`,
    [spot_id]
  );
  if (!spotRows[0]) {
    return NextResponse.json({ error: "spot not found" }, { status: 404 });
  }
  // 行が無い(=設定されていない)場合は既定のtrueとして扱う(lib/types.tsのSPOT_TYPE_SETTING_DEFAULTS参照)
  if (spotRows[0].reviews_enabled === "false") {
    return NextResponse.json(
      { error: "このスポット種別では口コミが無効になっています。" },
      { status: 400 }
    );
  }
  if (spotRows[0].status !== "published") {
    return NextResponse.json(
      { error: "公開されているスポットにのみ口コミを投稿できます。" },
      { status: 400 }
    );
  }

  const { rows } = await query<Review>(
    `insert into reviews (user_id, spot_id, body, visibility)
     values ($1, $2, $3, 'public')
     returning id, spot_id, body, visibility, created_at`,
    [userId, spot_id, body.trim()]
  );
  return NextResponse.json({ data: rows[0] });
}
