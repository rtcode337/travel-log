import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import type { PublicReview, Review } from "@/lib/types";

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const spotId = searchParams.get("spot_id");
  if (!spotId) {
    return NextResponse.json({ error: "spot_id is required" }, { status: 400 });
  }

  if (searchParams.get("mine") === "true") {
    const { rows } = await query<Review>(
      `select id, spot_id, body, visibility, created_at
       from reviews where spot_id = $1 and user_id = $2`,
      [spotId, userId]
    );
    return NextResponse.json({ data: rows[0] ?? null });
  }

  const { rows } = await query<PublicReview>(
    `select r.id, r.body, r.created_at, u.email as user_email
     from reviews r
     join users u on u.id = r.user_id
     where r.spot_id = $1 and r.visibility = 'public'
     order by r.created_at desc`,
    [spotId]
  );
  return NextResponse.json({ data: rows });
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

  const { rows } = await query<Review>(
    `insert into reviews (user_id, spot_id, body, visibility)
     values ($1, $2, $3, 'public')
     on conflict (user_id, spot_id)
     do update set body = excluded.body, visibility = 'public'
     returning id, spot_id, body, visibility, created_at`,
    [userId, spot_id, body.trim()]
  );
  return NextResponse.json({ data: rows[0] });
}
