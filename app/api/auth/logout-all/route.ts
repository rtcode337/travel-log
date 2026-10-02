import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * すべての端末からログアウトする。セッションは署名付きCookieでサーバーに状態を
 * 持たないので、「この時刻より前に発行したセッションは無効」を記録して取り消す
 * (`users.sessions_valid_after`)。この端末のCookieも消す。
 */
export async function POST() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await query("update users set sessions_valid_after = now() where id = $1", [userId]);
  const response = NextResponse.json({ data: { ok: true } });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
