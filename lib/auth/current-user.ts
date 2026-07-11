import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { query } from "@/lib/db";
import type { Role } from "@/lib/types";

export async function getCurrentUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
  return session?.userId ?? null;
}

/**
 * roleはCookieには含めず(管理者がロール変更した際に古いCookieのまま権限が
 * 残り続けるのを防ぐため)、リクエストのたびにDBから取得する。
 */
export async function getCurrentUser(): Promise<{ id: string; role: Role } | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const { rows } = await query<{ id: string; role: Role }>(
    "select id, role from users where id = $1",
    [userId]
  );
  return rows[0] ?? null;
}
