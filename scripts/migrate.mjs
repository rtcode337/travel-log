// スキーマ本体(db/init/01_schema.sql)と db/migrations の未適用SQLを順に適用する。
//
// アプリの起動時に走る(Dockerfile の CMD が server.js の前に呼ぶ)ほか、外部DBへ
// 当てるときは scripts/migrate-remote.sh がこのスクリプトをコンテナ内で実行する。
// 適用の中身を1か所に持つことで、Docker運用とホスティング先とで当たるSQLがずれない。
//
// かつては postgres イメージに psql を積んだ専用イメージ(db/Dockerfile、
// composeの init サービス)がこれをやっていた。アプリが同じDBへ pg で繋いでいる以上、
// イメージとサービスをもう1つ持つ理由が無いのでアプリ側へ寄せた。
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? path.join(ROOT, "db/migrations");
const SCHEMA_FILE = process.env.SCHEMA_FILE ?? path.join(ROOT, "db/init/01_schema.sql");
// スキーマ本体を schema_migrations に記録するときのバージョン名(常に連番の先頭)
const SCHEMA_VERSION = "000_init_schema";
// マイグレーションの同時実行を防ぐための advisory lock のキー(任意の定数)。
// 値を変えると、旧版と新版が同時に走ったときに互いを排除できなくなる
const LOCK_KEY = 8241973;
const READY_TIMEOUT_SECONDS = 60;

// psql は PGSSLMODE を自分で読むが、pg は読まない(既定は ssl: false)。
// 外部DB(Supabase等)は TLS 必須なので、ここで psql と同じ意味に翻訳する。
// require はサーバー証明書の検証まではしない —— verify-* との違いがそこ
function sslFromEnv() {
  const mode = process.env.PGSSLMODE;
  if (!mode || mode === "disable" || mode === "allow") return false;
  return { rejectUnauthorized: mode === "verify-ca" || mode === "verify-full" };
}

function connectionConfig() {
  // DATABASE_URL があればそちら(接続文字列の sslmode は pg が解釈する)。
  // 無ければ PG* 環境変数(pg の既定の読み方。migrate-remote.sh はこちら)
  return process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : { ssl: sslFromEnv() };
}

// composeでは db の healthcheck 通過後に起動する想定だが、単体で起動された場合や
// 再起動直後にも耐えるよう自前でも待つ
async function connectWithRetry() {
  const deadline = Date.now() + READY_TIMEOUT_SECONDS * 1000;
  for (;;) {
    const client = new pg.Client(connectionConfig());
    try {
      await client.connect();
      return client;
    }
    catch (error) {
      await client.end().catch(() => {});
      if (Date.now() >= deadline) {
        throw new Error(
          `migrate: database did not become ready in ${READY_TIMEOUT_SECONDS}s: ${error.message}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function isApplied(client, version) {
  const { rowCount } = await client.query(
    "select 1 from schema_migrations where version = $1",
    [version],
  );
  return rowCount > 0;
}

// SQL本体と適用記録を1トランザクションにまとめる(途中で失敗したら記録も残らないので、
// 直して再実行すればよい)。advisory lock は複数のプロセスが同時に走った場合に
// 二重適用しないためのもの。パラメータを付けずに投げるので、1ファイルに複数の文が
// 入っていてもまとめて実行される
async function applyInTransaction(client, version, sql) {
  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock($1)", [LOCK_KEY]);
    if (sql !== null) await client.query(sql);
    await client.query(
      "insert into schema_migrations (version) values ($1) on conflict (version) do nothing",
      [version],
    );
    await client.query("commit");
  }
  catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function migrate() {
  const client = await connectWithRetry();
  try {
    // 適用済みリビジョンの記録テーブル。マイグレーション自身ではなくここが作る
    // (新規DBでもこのテーブルだけは必ず存在する状態にするため)
    await client.query(`
      create table if not exists schema_migrations (
        version    text primary key,
        applied_at timestamptz not null default now()
      )`);

    // スキーマ本体。既にテーブルがあるDB(旧方式でinitdbが作ったもの)には流さず、
    // 「適用済み」として記録するだけにする —— 既存の本番DBをそのまま引き継ぐため
    if (!(await isApplied(client, SCHEMA_VERSION))) {
      const { rows } = await client.query("select to_regclass('public.spot_types') as reg");
      if (rows[0].reg !== null) {
        console.log(`migrate: schema already exists, marking ${SCHEMA_VERSION} as applied`);
        await applyInTransaction(client, SCHEMA_VERSION, null);
      }
      else {
        console.log(`migrate: applying ${SCHEMA_VERSION}`);
        await applyInTransaction(client, SCHEMA_VERSION, await readFile(SCHEMA_FILE, "utf8"));
      }
    }

    let applied = 0;
    let skipped = 0;
    // ファイル名の昇順で 001_/002_ の連番順に適用される(シェルのグロブと同じ順)
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const version = path.basename(file, ".sql");
      if (await isApplied(client, version)) {
        skipped += 1;
        continue;
      }
      console.log(`migrate: applying ${version}`);
      await applyInTransaction(
        client,
        version,
        await readFile(path.join(MIGRATIONS_DIR, file), "utf8"),
      );
      applied += 1;
    }

    console.log(`migrate: migrations done (applied=${applied}, skipped=${skipped})`);
  }
  finally {
    await client.end().catch(() => {});
  }
}

migrate().catch((error) => {
  // 起動を続けさせない。composeのrestartで再試行になるので、DBがまだ起きていない
  // だけなら次の回で通る。SQLが壊れている場合はログに同じ理由が出続ける
  console.error(`migrate: failed: ${error.message}`);
  process.exit(1);
});
