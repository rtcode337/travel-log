import { query } from "@/lib/db";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_STATE_COOKIE = "google_oauth_state";

interface GoogleProfile {
  sub: string;
  email: string;
}

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function getGoogleCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET is not set");
  }
  return { clientId, clientSecret };
}

export function buildGoogleAuthUrl(redirectUri: string, state: string): string {
  const { clientId } = getGoogleCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string
): Promise<{ access_token: string } | null> {
  const { clientId, clientSecret } = getGoogleCredentials();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchGoogleProfile(
  accessToken: string
): Promise<GoogleProfile | null> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const body = await res.json();
  if (typeof body.sub !== "string" || typeof body.email !== "string") return null;
  // email_verifiedがfalseの場合、本人が所有していないメールアドレスを名乗れてしまう
  // (Google Workspaceの未検証セカンダリメール等)。findOrCreateGoogleUserはメール一致
  // だけで既存アカウントに紐付けるため、ここで弾かないとアカウント乗っ取りに繋がる
  if (body.email_verified !== true) return null;
  return { sub: body.sub, email: body.email };
}

/**
 * 自由サインアップは提供しない方針(新規アカウントは管理者が /admin から作成する)のため、
 * Googleログインで新規ユーザーは作らない。行うのは
 * 「メールアドレスが一致する既存アカウントへの google_id の紐付け」か、
 * 「ユーザーが1人もいない初回セットアップ時に限り最初のadminアカウントを作成」のみ
 * (setup APIのパスワード登録と同じ制約)。
 */
export async function findOrCreateGoogleUser(
  profile: GoogleProfile
): Promise<{ id: string } | null> {
  const byGoogleId = await query<{ id: string }>(
    "select id from users where google_id = $1",
    [profile.sub]
  );
  if (byGoogleId.rows[0]) return byGoogleId.rows[0];

  const byEmail = await query<{ id: string }>(
    "select id from users where email = $1",
    [profile.email]
  );
  if (byEmail.rows[0]) {
    await query("update users set google_id = $1 where id = $2", [
      profile.sub,
      byEmail.rows[0].id,
    ]);
    return byEmail.rows[0];
  }

  const inserted = await query<{ id: string }>(
    `insert into users (email, google_id, role)
     select $1, $2, 'admin'
     where not exists (select 1 from users)
     returning id`,
    [profile.email, profile.sub]
  );
  return inserted.rows[0] ?? null;
}
