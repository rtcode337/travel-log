import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { SpotType } from "@/lib/types";
import { SPOT_TYPE_SELECT } from "@/lib/spot-types-query";

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
  const { visibility, settings } = await request.json();

  if (visibility === undefined && settings === undefined) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { rows: existingRows } = await query("select 1 from spot_types where id = $1", [id]);
  if (!existingRows[0]) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (visibility !== undefined) {
    if (!["public", "admin_only", "disabled"].includes(visibility)) {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }
    if (visibility !== "public") {
      // ログイン後の既定(app_settings.active_spot_type_id)がこの種類のままだと
      // 一般ユーザーのルート("/")が404するページへリダイレクトし続けてしまうため、
      // 公開以外への変更を禁止する
      const { rows: activeRows } = await query(
        "select 1 from app_settings where active_spot_type_id = $1",
        [id]
      );
      if (activeRows[0]) {
        return NextResponse.json(
          { error: "ログイン後既定の種類は有効以外にできません。先に既定を変更してください。" },
          { status: 400 }
        );
      }
    }
    await query("update spot_types set visibility = $1 where id = $2", [visibility, id]);
  }

  // スポットの種類ごとの追加設定(口コミ・Wikipediaリンク等)。spot_typesに列を
  // 増やさずキーを増やせるよう、spot_type_settings(key, value)へupsertする
  // (現状は値がすべてboolean相当のため文字列'true'/'false'で保存)
  if (settings !== undefined) {
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value !== "boolean") {
        return NextResponse.json({ error: "invalid request" }, { status: 400 });
      }
      await query(
        `insert into spot_type_settings (spot_type_id, key, value)
         values ($1, $2, $3)
         on conflict (spot_type_id, key) do update set value = excluded.value`,
        [id, key, String(value)]
      );
    }
  }

  const { rows } = await query<SpotType>(`${SPOT_TYPE_SELECT} where t.id = $1`, [id]);
  return NextResponse.json({ data: rows[0] });
}
