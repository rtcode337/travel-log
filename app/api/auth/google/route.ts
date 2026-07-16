import { NextResponse } from "next/server";
import {
  buildGoogleAuthUrl,
  GOOGLE_STATE_COOKIE,
  isGoogleConfigured,
} from "@/lib/auth/google";
import { getExternalOrigin, isSecureRequest } from "@/lib/auth/request-url";

export async function GET(request: Request) {
  // 未設定時はログイン画面にボタンを出さないが、URL直叩きにも備える
  if (!isGoogleConfigured()) {
    return NextResponse.redirect(
      new URL("/login", getExternalOrigin(request))
    );
  }

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
