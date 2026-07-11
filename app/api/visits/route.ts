import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import type { Visit } from "@/lib/types";

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const spotId = searchParams.get("spot_id");

  const { rows } = spotId
    ? await query<Visit>(
        `select * from visits where user_id = $1 and spot_id = $2
         order by visited_on desc nulls last`,
        [userId, spotId]
      )
    : await query<Visit>("select * from visits where user_id = $1", [userId]);

  return NextResponse.json({ data: rows });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { rows } = await query<Visit>(
    `insert into visits (user_id, spot_id, visited_on, date_precision, memo, photos)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [
      userId,
      body.spot_id,
      body.visited_on,
      body.date_precision,
      body.memo,
      body.photos ?? [],
    ]
  );

  return NextResponse.json({ data: rows[0] });
}
