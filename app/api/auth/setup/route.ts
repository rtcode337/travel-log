import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";
import { isSecureRequest } from "@/lib/auth/request-url";

export async function POST(request: Request) {
  const { email, password } = await request.json();

  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "パスワードは8文字以上にしてください。" },
      { status: 400 }
    );
  }

  const { rows } = await query<{ id: string }>(
    `insert into users (email, password_hash, role)
     select $1, crypt($2, gen_salt('bf')), 'admin'
     where not exists (select 1 from users)
     returning id`,
    [email, password]
  );

  const user = rows[0];
  if (!user) {
    return NextResponse.json(
      { error: "既にアカウントが作成済みです。" },
      { status: 409 }
    );
  }

  const token = await createSessionToken(user.id);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return response;
}
