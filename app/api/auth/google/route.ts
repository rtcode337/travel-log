import { NextResponse } from "next/server";
import { buildGoogleAuthUrl, GOOGLE_STATE_COOKIE } from "@/lib/auth/google";

export async function GET(request: Request) {
  const state = crypto.randomUUID();
  const redirectUri = new URL("/api/auth/google/callback", request.url).toString();

  const response = NextResponse.redirect(buildGoogleAuthUrl(redirectUri, state));
  response.cookies.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 300,
    path: "/",
  });
  return response;
}
