import { NextResponse } from "next/server";
import { buildGoogleAuthUrl, GOOGLE_STATE_COOKIE } from "@/lib/auth/google";
import { getExternalOrigin, isSecureRequest } from "@/lib/auth/request-url";

export async function GET(request: Request) {
  const state = crypto.randomUUID();
  const redirectUri = new URL(
    "/api/auth/google/callback",
    getExternalOrigin(request)
  ).toString();

  const response = NextResponse.redirect(buildGoogleAuthUrl(redirectUri, state));
  response.cookies.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    maxAge: 300,
    path: "/",
  });
  return response;
}
