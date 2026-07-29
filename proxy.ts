import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import {
  LAST_SPOT_TYPE_COOKIE,
  LAST_SPOT_TYPE_MAX_AGE,
  SPOT_TYPE_PATH_PATTERN,
} from "@/lib/last-spot-type";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  const isLoginPage = request.nextUrl.pathname.startsWith("/login");

  if (!session && !isLoginPage) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  }

  if (session && isLoginPage) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    return NextResponse.redirect(redirectUrl);
  }

  const response = NextResponse.next();

  // 最後に開いていたスポット種別を覚えておき、次回起動時(ルート`/`)の
  // リダイレクト先に使う(lib/last-spot-type.ts参照)。値が同じ間は再セットしない
  const typeKey = request.nextUrl.pathname.match(SPOT_TYPE_PATH_PATTERN)?.[1];
  if (
    session &&
    typeKey &&
    request.cookies.get(LAST_SPOT_TYPE_COOKIE)?.value !== typeKey
  ) {
    response.cookies.set(LAST_SPOT_TYPE_COOKIE, typeKey, {
      path: "/",
      maxAge: LAST_SPOT_TYPE_MAX_AGE,
      httpOnly: true,
      sameSite: "lax",
    });
  }

  return response;
}

export const config = {
  matcher: [
    // manifest.webmanifest(app/manifest.ts)を除外しているのは、ブラウザのmanifest取得が
    // 既定でCookieなしで行われるため。ガード対象のままだと/loginリダイレクトが返り
    // PWAとしてインストールできなくなる
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
