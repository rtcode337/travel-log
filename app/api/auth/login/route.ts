import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";
import { isSecureRequest } from "@/lib/auth/request-url";

export async function POST(request: Request) {
  const { email, password } = await request.json();

  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { rows } = await query<{ id: string }>(
    "select id from users where email = $1 and password_hash = crypt($2, password_hash)",
    [email, password]
  );

  const user = rows[0];
  if (!user) {
    return NextResponse.json(
      { error: "メールアドレスまたはパスワードが正しくありません。" },
      { status: 401 }
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
