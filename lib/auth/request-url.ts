/**
 * リバースプロキシ(nginxでのHTTPS終端)の背後で動く場合、Next.jsが直接受け取る
 * リクエストは常にプロキシからのプレーンHTTPになるため、request.url や
 * NODE_ENV だけでは「ブラウザから見て実際にHTTPSだったか」を判定できない。
 * X-Forwarded-Proto/X-Forwarded-Host (nginx側で設定)を優先して見る。
 *
 * プロキシがそれらのヘッダを送らない構成(NASのリバースプロキシ機能など、設定項目が
 * 無いものもある)では、環境変数 PUBLIC_BASE_URL に公開URL(例: https://travel.example.com)を
 * 設定する。設定されていればヘッダやリクエストより優先して使うため、Googleログインの
 * リダイレクトURIが http:// で組まれて認証に失敗する問題を回避できる。
 * 未設定なら従来どおりヘッダ→リクエストの順で自動導出する。
 */

/**
 * PUBLIC_BASE_URL をURLとして解釈する。未設定・解釈できない値ならnull
 * (その場合は自動導出にフォールバックする)。パス部分は使わず、
 * スキーム・ホスト・ポートだけを見る。
 */
function publicBaseUrl(): URL | null {
  const raw = process.env.PUBLIC_BASE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    console.warn(
      `PUBLIC_BASE_URL の値をURLとして解釈できないため無視します: ${raw}`
    );
    return null;
  }
}

export function isSecureRequest(request: Request): boolean {
  const base = publicBaseUrl();
  if (base) return base.protocol === "https:";
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return new URL(request.url).protocol === "https:";
}

export function getExternalOrigin(request: Request): string {
  const base = publicBaseUrl();
  if (base) return base.origin;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  if (proto && host) return `${proto}://${host}`;
  return new URL(request.url).origin;
}
