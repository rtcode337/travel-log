import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { SpotType } from "@/lib/types";

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
  const { reviews_enabled } = await request.json();

  const sets: string[] = [];
  const values: unknown[] = [];

  if (reviews_enabled !== undefined) {
    if (typeof reviews_enabled !== "boolean") {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }
    values.push(reviews_enabled);
    sets.push(`reviews_enabled = $${values.length}`);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  values.push(id);
  const { rows } = await query<SpotType>(
    `update spot_types set ${sets.join(", ")} where id = $${values.length} returning *`,
    values
  );
  if (!rows[0]) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ data: rows[0] });
}
