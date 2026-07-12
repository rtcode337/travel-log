/**
 * リバースプロキシ(nginxでのHTTPS終端)の背後で動く場合、Next.jsが直接受け取る
 * リクエストは常にプロキシからのプレーンHTTPになるため、request.url や
 * NODE_ENV だけでは「ブラウザから見て実際にHTTPSだったか」を判定できない。
 * X-Forwarded-Proto/X-Forwarded-Host (nginx側で設定)を優先して見る。
 */

export function isSecureRequest(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return new URL(request.url).protocol === "https:";
}

export function getExternalOrigin(request: Request): string {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  if (proto && host) return `${proto}://${host}`;
  return new URL(request.url).origin;
}
