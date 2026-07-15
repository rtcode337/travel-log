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
  const { reviews_enabled, enabled } = await request.json();

  const sets: string[] = [];
  const values: unknown[] = [];

  if (reviews_enabled !== undefined) {
    if (typeof reviews_enabled !== "boolean") {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }
    values.push(reviews_enabled);
    sets.push(`reviews_enabled = $${values.length}`);
  }

  if (enabled !== undefined) {
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }
    if (enabled === false) {
      // ログイン後の既定(app_settings.active_spot_type_id)がこの種類のままだと
      // ルート("/")が404するページへリダイレクトし続けてしまうため、無効化を禁止する
      const { rows: activeRows } = await query(
        "select 1 from app_settings where active_spot_type_id = $1",
        [id]
      );
      if (activeRows[0]) {
        return NextResponse.json(
          { error: "ログイン後既定の種類は無効にできません。先に既定を変更してください。" },
          { status: 400 }
        );
      }
    }
    values.push(enabled);
    sets.push(`enabled = $${values.length}`);
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
