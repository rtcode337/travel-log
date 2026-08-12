import { Pool, types, type QueryResultRow } from "pg";

// pgのデフォルトはdate型をJSのDateオブジェクトにパースし、シリアライズ時に
// タイムゾーン付きのISO日時文字列("...T00:00:00.000Z")になってしまう
// (サーバーのタイムゾーンによっては日付がずれることもある)。
// DB上の"YYYY-MM-DD"のままフロントに渡すため、date型のパースを無効化する。
// 現在のスキーマにdate型の列は無い(visits.visited_onはtimestamptzで、こちらは
// ISO 8601文字列としてそのままフロントに渡してよい)が、将来date型を足したときに
// 同じ問題を踏まないよう残してある。
types.setTypeParser(types.builtins.DATE, (value) => value);

const globalForPg = globalThis as unknown as { pgPool?: Pool };

/**
 * 1インスタンスが張る接続数の上限(未設定なら`pg`の既定=10)。
 *
 * **サーバーレスで下げるための設定**。関数インスタンスは同時に何本も立ち上がり、
 * それぞれがこのプールを持つため、既定のままだと接続プーラー側の枠を食い潰す
 * (Supabaseの無料プランは接続数が限られる)。Vercelでは3程度に下げる。
 * 常駐プロセス1つで動くDocker運用では未設定のままでよい。
 */
const poolMax = Number(process.env.PG_POOL_MAX) || undefined;

export const pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: poolMax,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPg.pgPool = pool;
}

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
) {
  return pool.query<T>(text, params);
}
