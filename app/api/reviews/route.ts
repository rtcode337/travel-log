import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import type { MyReview, PublicReview, Review } from "@/lib/types";

const PAGE_SIZE = 10;

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
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
      return NextResponse.json({ error: "存在しない種類です。" }, { status: 404 });
    }
    const { rows } = await query<MyReview>(
      `select r.id, r.spot_id, r.body, r.created_at,
         s.name as spot_name, s.prefecture as spot_prefecture,
         s.municipality as spot_municipality, s.rank as spot_rank
       from reviews r
       join spots s on s.id = r.spot_id
       where r.user_id = $1 and s.spot_type_id = $2
       order by r.created_at desc`,
      [userId, typeRows[0].id]
    );
    return NextResponse.json({ data: rows });
  }

  const spotId = searchParams.get("spot_id");
  if (!spotId) {
    return NextResponse.json({ error: "spot_id is required" }, { status: 400 });
  }
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const [{ rows }, { rows: countRows }] = await Promise.all([
    query<PublicReview>(
      `select r.id, r.body, r.created_at, coalesce(u.nickname, u.email) as user_name
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
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { spot_id, body } = await request.json();
  if (typeof spot_id !== "string" || typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { rows: spotRows } = await query<{
    reviews_enabled: boolean;
    status: string;
  }>(
    `select st.reviews_enabled, s.status
     from spots s join spot_types st on st.id = s.spot_type_id
     where s.id = $1`,
    [spot_id]
  );
  if (!spotRows[0]) {
    return NextResponse.json({ error: "spot not found" }, { status: 404 });
  }
  if (!spotRows[0].reviews_enabled) {
    return NextResponse.json(
      { error: "このスポットの種類では口コミが無効になっています。" },
      { status: 400 }
    );
  }
  if (spotRows[0].status === "private") {
    return NextResponse.json(
      { error: "非公開スポットには口コミを投稿できません。" },
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
