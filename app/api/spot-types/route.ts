import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSpotTypeSetting, SPOT_ADMIN_ROLES, type SpotType } from "@/lib/types";
import { SPOT_TYPE_ORDER, SPOT_TYPE_SELECT } from "@/lib/spot-types-query";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { rows } = await query<SpotType>(`${SPOT_TYPE_SELECT} ${SPOT_TYPE_ORDER}`);
  // public_visible設定がfalse(既定)の種別はadmin/spot_admin以外には存在自体を見せない
  const visible = SPOT_ADMIN_ROLES.includes(user.role)
    ? rows
    : rows.filter((t) => getSpotTypeSetting(t, "public_visible"));
  return NextResponse.json({ data: visible });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { key, label } = await request.json();
  if (typeof key !== "string" || !key.trim() || typeof label !== "string" || !label.trim()) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  try {
    // **新しい種別は並びの最後に足す。** sort_orderの既定値0のまま入れると、管理画面で
    // 並び替えた後(0, 1, 2, …が振られている)に足した種別が先頭のあたりへ割り込む。
    // 1文で最大値+1を取るので、同時に2つ足しても並びが崩れるだけで失敗はしない
    const { rows } = await query<Omit<SpotType, "settings">>(
      `insert into spot_types (key, label, sort_order)
       values ($1, $2, (select coalesce(max(sort_order), -1) + 1 from spot_types))
       returning *`,
      [key.trim(), label.trim()]
    );
    // 新規作成直後はsettings行が1件も無いので空オブジェクトで補う(既定値扱い)
    return NextResponse.json({ data: { ...rows[0], settings: {} } });
  } catch (err) {
    const code = (err as { code?: string }).code;
    const message =
      code === "23505"
        ? "このキーは既に使われています。"
        : err instanceof Error
          ? err.message
          : "作成に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
