import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import type { SpotNote } from "@/lib/types";

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const spotId = searchParams.get("spot_id");

  const { rows } = spotId
    ? await query<SpotNote>(
        `select * from spot_notes where user_id = $1 and spot_id = $2
         order by noted_on desc nulls last, created_at desc`,
        [userId, spotId]
      )
    : await query<SpotNote>(
        `select * from spot_notes where user_id = $1
         order by noted_on desc nulls last, created_at desc`,
        [userId]
      );

  return NextResponse.json({ data: rows });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  if (typeof body.spot_id !== "string") {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  // 日時は任意だがメモが本体なので、メモ無しの記録は作らせない
  const memo = typeof body.memo === "string" ? body.memo.trim() : "";
  if (!memo) {
    return NextResponse.json({ error: "メモを入力してください。" }, { status: 400 });
  }

  const { rows } = await query<SpotNote>(
    `insert into spot_notes (user_id, spot_id, noted_on, memo)
     values ($1, $2, $3, $4)
     returning *`,
    [userId, body.spot_id, body.noted_on ?? null, memo]
  );
  return NextResponse.json({ data: rows[0] });
}
