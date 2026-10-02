import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { query } from "@/lib/db";
import type { Role } from "@/lib/types";

/**
 * Cookieの署名が正しくても、そのユーザーが既にDBに存在しない(削除された/
 * DBを作り直した)場合や、セッションが取り消し済みの場合はnullを返す。署名検証だけだと、DBを作り直した後も
 * 古いCookieが「有効なセッション」として通ってしまうため必ずDBを引く。
 */
export async function getCurrentUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
  if (!session) return null;

  // 「すべての端末からログアウト」より前に発行されたセッションは取り消し済みとして扱う
  const { rows } = await query<{ id: string }>(
    `select id from users
      where id = $1
        and (sessions_valid_after is null
             or sessions_valid_after <= to_timestamp($2::double precision / 1000))`,
    [session.userId, session.issuedAt]
  );
  return rows[0]?.id ?? null;
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
