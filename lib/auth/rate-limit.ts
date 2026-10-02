/**
 * ログイン試行に対する簡易レート制限(インメモリ)。
 * このアプリは単一プロセス・単一コンテナで動く前提(docker-composeで複数レプリカに
 * スケールしない)ため、インメモリのMapで十分に機能する。プロセス再起動で状態は
 * リセットされる(Redis等の外部ストアは導入していない)。
 */

const WINDOW_MS = 15 * 60 * 1000; // 15分
const MAX_ATTEMPTS = 10;
/** 覚えておくキーの上限。使い捨てのキーを大量に送られてもメモリが際限なく増えないように */
const MAX_BUCKETS = 10000;

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
export function isRateLimited(key: string, maxAttempts = MAX_ATTEMPTS): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) return false;
  return bucket.count >= maxAttempts;
}

export function recordFailure(key: string): void {
  const now = Date.now();
  if (buckets.size >= MAX_BUCKETS) {
    prune(now);
    // 期限内のキーだけで溢れているときは古いものから捨てる(Mapは挿入順に回る)
    for (const oldest of buckets.keys()) {
      if (buckets.size < MAX_BUCKETS) break;
      buckets.delete(oldest);
    }
  }

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

/**
 * リクエストからクライアントIPを取り出す(プロキシ経由の場合はX-Forwarded-Forの**末尾**)。
 *
 * 先頭はクライアントが自由に書ける —— 一般的なリバースプロキシは届いたヘッダの後ろに
 * 自分が見た接続元を足すだけなので、偽の値を付けて送れば先頭はいくらでも変えられる。
 * 末尾はこちらのプロキシが足した値なので、プロキシ1段の構成ならこれが本当の接続元。
 * プロキシを通さず直接受けている構成ではどちらも偽装できるので、ログインはメールアドレス
 * 単位の制限(`login/route.ts`)でも守る。
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return "unknown";
}
