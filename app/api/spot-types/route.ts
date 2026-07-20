import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_ADMIN_ROLES, type SpotType } from "@/lib/types";
import { SPOT_TYPE_SELECT } from "@/lib/spot-types-query";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // admin_only・disabledの種別はadmin/spot_admin以外には存在自体を見せない
  const { rows } = await query<SpotType>(
    SPOT_ADMIN_ROLES.includes(user.role)
      ? `${SPOT_TYPE_SELECT} order by t.created_at asc`
      : `${SPOT_TYPE_SELECT} where t.visibility = 'public' order by t.created_at asc`
  );
  return NextResponse.json({ data: rows });
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
    const { rows } = await query<Omit<SpotType, "settings">>(
      "insert into spot_types (key, label) values ($1, $2) returning *",
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
