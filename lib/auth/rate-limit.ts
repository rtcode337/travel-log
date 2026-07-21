/**
 * ログイン試行に対する簡易レート制限(インメモリ)。
 * このアプリは単一プロセス・単一コンテナで動く前提(docker-composeで複数レプリカに
 * スケールしない)ため、インメモリのMapで十分に機能する。プロセス再起動で状態は
 * リセットされる(Redis等の外部ストアは導入していない)。
 */

const WINDOW_MS = 15 * 60 * 1000; // 15分
const MAX_ATTEMPTS = 10;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// bucketsが際限なく増え続けないよう、アクセスのたびに期限切れのentryを間引く
function prune(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * keyごとの試行回数を確認する。呼び出し側は「試行前に許可されるか」を見て、
 * 失敗した場合のみrecordFailureで加算する(成功時は加算しない)。
 */
export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) return false;
  return bucket.count >= MAX_ATTEMPTS;
}

export function recordFailure(key: string): void {
  const now = Date.now();
  if (buckets.size > 10000) prune(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  bucket.count++;
}

export function clearAttempts(key: string): void {
  buckets.delete(key);
}

/** リクエストからクライアントIPを取り出す(プロキシ経由の場合はX-Forwarded-Forの先頭) */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}
