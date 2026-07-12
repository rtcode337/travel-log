import { Pool, types, type QueryResultRow } from "pg";

// pgのデフォルトはdate型をJSのDateオブジェクトにパースし、シリアライズ時に
// タイムゾーン付きのISO日時文字列("...T00:00:00.000Z")になってしまう
// (サーバーのタイムゾーンによっては日付がずれることもある)。
// DB上の"YYYY-MM-DD"のままフロントに渡すため、date型のパースを無効化する。
types.setTypeParser(types.builtins.DATE, (value) => value);

const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
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
