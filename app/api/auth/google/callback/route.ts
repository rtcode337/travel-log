import { NextResponse } from "next/server";
import {
  exchangeGoogleCode,
  fetchGoogleProfile,
  findOrCreateGoogleUser,
  GOOGLE_STATE_COOKIE,
} from "@/lib/auth/google";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";
import { getExternalOrigin, isSecureRequest } from "@/lib/auth/request-url";

export async function GET(request: Request) {
  const origin = getExternalOrigin(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieState = cookieHeader
    .split("; ")
    .find((c) => c.startsWith(`${GOOGLE_STATE_COOKIE}=`))
    ?.split("=")[1];

  const failure = NextResponse.redirect(new URL("/login?error=google", origin));
  failure.cookies.delete(GOOGLE_STATE_COOKIE);

  if (!code || !state || !cookieState || state !== cookieState) {
    return failure;
  }

  const redirectUri = new URL("/api/auth/google/callback", origin).toString();
  const tokens = await exchangeGoogleCode(code, redirectUri);
  if (!tokens) return failure;

  const profile = await fetchGoogleProfile(tokens.access_token);
  if (!profile) return failure;

  const user = await findOrCreateGoogleUser(profile);
  if (!user) return failure;

  const token = await createSessionToken(user.id);
  const response = NextResponse.redirect(new URL("/", origin));
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  response.cookies.delete(GOOGLE_STATE_COOKIE);
  return response;
}
