import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { AppUser, Role } from "@/lib/types";

const ROLES: Role[] = ["admin", "moderator", "user"];

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
  const { role } = await request.json();
  if (!ROLES.includes(role)) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }

  if (id === user.id) {
    return NextResponse.json(
      { error: "自分自身のロールは変更できません。" },
      { status: 400 }
    );
  }

  const { rows: targetRows } = await query<{ role: Role }>(
    "select role from users where id = $1",
    [id]
  );
  const target = targetRows[0];
  if (!target) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (target.role === "admin" && role !== "admin") {
    const { rows } = await query<{ count: string }>(
      "select count(*) from users where role = 'admin' and id != $1",
      [id]
    );
    if (Number(rows[0].count) === 0) {
      return NextResponse.json(
        { error: "最後の管理者のロールは変更できません。" },
        { status: 400 }
      );
    }
  }

  const { rows } = await query<AppUser>(
    `update users set role = $1 where id = $2
     returning id, email, role, created_at,
       (password_hash is not null) as has_password,
       (google_id is not null) as has_google`,
    [role, id]
  );
  return NextResponse.json({ data: rows[0] });
}
