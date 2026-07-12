import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { AppUser, Role } from "@/lib/types";

const ROLES: Role[] = ["admin", "moderator", "user"];

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { rows } = await query<AppUser>(
    `select id, email, nickname, role, created_at,
       (password_hash is not null) as has_password,
       (google_id is not null) as has_google
     from users
     order by created_at asc`
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

  const { email, password, role, nickname } = await request.json();
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "パスワードは8文字以上にしてください。" },
      { status: 400 }
    );
  }
  if (!ROLES.includes(role)) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }

  try {
    const { rows } = await query<AppUser>(
      `insert into users (email, password_hash, role, nickname)
       values ($1, crypt($2, gen_salt('bf')), $3, $4)
       returning id, email, nickname, role, created_at,
         (password_hash is not null) as has_password,
         (google_id is not null) as has_google`,
      [email, password, role, typeof nickname === "string" ? nickname.trim() || null : null]
    );
    return NextResponse.json({ data: rows[0] });
  } catch (err) {
    const code = (err as { code?: string }).code;
    const message =
      code === "23505"
        ? "このメールアドレスは既に使われています。"
        : err instanceof Error
          ? err.message
          : "作成に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
