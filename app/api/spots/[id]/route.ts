import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser, getCurrentUserId } from "@/lib/auth/current-user";
import type { Spot } from "@/lib/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { rows } = await query<Spot>("select * from spots where id = $1", [id]);
  return NextResponse.json({ data: rows[0] ?? null });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { id } = await params;
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
  if (user.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { id } = await params;
  await query("delete from spots where id = $1", [id]);
  return NextResponse.json({ ok: true });
}
