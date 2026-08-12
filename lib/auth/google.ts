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
 * Googleログインで新規アカウントを自動作成するか(既定は作らない)。
 *
 * **既定は従来どおり「自由サインアップなし」**(新規アカウントは管理者が /admin から
 * 作成する)。`GOOGLE_AUTO_SIGNUP=true` を設定した環境でだけ、Googleでログインした人を
 * 一般ユーザー(role='user')として自動登録する。
 *
 * **有効にすると、URLを知っていてGoogleアカウントを持つ人は誰でも入れる。**
 * 自分だけ・身内だけで使うつもりのインスタンスで有効にしないこと。
 */
export function isGoogleAutoSignupEnabled(): boolean {
  return process.env.GOOGLE_AUTO_SIGNUP === "true";
}

/**
 * Googleプロフィールからユーザーを解決する。行うのは
 * 「google_id での照合」「メールアドレスが一致する既存アカウントへの google_id の紐付け」
 * 「ユーザーが1人もいない初回セットアップ時に限り最初のadminアカウントを作成」
 * (setup APIのパスワード登録と同じ制約)の3つ。
 * これらに当たらない場合、`GOOGLE_AUTO_SIGNUP=true` のときだけ一般ユーザーを新規作成する。
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

  // 初回セットアップ(ユーザーが1人もいない)なら最初のadminを作る。
  // 条件をSQL側に置いてあるのは、同時に2人がログインしても片方しかadminに
  // ならないようにするため(not existsが1文の中で評価される)
  const firstAdmin = await query<{ id: string }>(
    `insert into users (email, google_id, role)
     select $1, $2, 'admin'
     where not exists (select 1 from users)
     returning id`,
    [profile.email, profile.sub]
  );
  if (firstAdmin.rows[0]) return firstAdmin.rows[0];

  if (!isGoogleAutoSignupEnabled()) return null;

  // 自動登録は常に一般ユーザー。emailの一意制約に当たった場合(上のbyEmailの
  // 直後に同じアドレスで作られた等)は何も作らず、次の照合に任せる
  const inserted = await query<{ id: string }>(
    `insert into users (email, google_id, role)
     values ($1, $2, 'user')
     on conflict (email) do nothing
     returning id`,
    [profile.email, profile.sub]
  );
  if (inserted.rows[0]) return inserted.rows[0];

  const retry = await query<{ id: string }>(
    "select id from users where email = $1",
    [profile.email]
  );
  return retry.rows[0] ?? null;
}
