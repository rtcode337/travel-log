import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_ADMIN_ROLES } from "@/lib/types";
import { readSeedSpots, type SeedSpotRow } from "@/lib/sqlSeed";

// 複数行VALUESの1文あたりの行数。1行9パラメータ+共通2なので、
// 1,000行でもPostgresのパラメータ上限(65,535)には遠く及ばない
const INSERT_CHUNK_SIZE = 1000;

function spotKey(name: string, prefecture: string, municipality: string | null) {
  return `${name}|${prefecture}|${municipality ?? ""}`;
}

async function resolveSpotType(typeKey: string) {
  const { rows } = await query<{ id: string }>(
    "select id from spot_types where key = $1",
    [typeKey]
  );
  return rows[0] ?? null;
}

/**
 * db/init/*.sqlのシードのうち、まだ`spots`テーブルに存在しない行を洗い出す。
 * 「存在する」の判定は name + prefecture + municipality の完全一致のみ(表記ゆれや
 * 座標近接による重複はここでは検出しない。CLAUDE.mdの注意書き通り、一括投入後は
 * 別途目視で重複確認すること)。
 */
async function diffSeedSpots(typeKey: string, spotTypeId: string) {
  const seedFiles = await readSeedSpots(typeKey);
  const { rows: existing } = await query<{
    name: string;
    prefecture: string;
    municipality: string | null;
  }>("select name, prefecture, municipality from spots where spot_type_id = $1", [
    spotTypeId,
  ]);
  const existingKeys = new Set(
    existing.map((s) => spotKey(s.name, s.prefecture, s.municipality))
  );

  const seenSeedKeys = new Set<string>();
  const missing: SeedSpotRow[] = [];
  let totalSeed = 0;
  for (const { rows } of seedFiles) {
    for (const row of rows) {
      totalSeed++;
      const key = spotKey(row.name, row.prefecture, row.municipality);
      if (existingKeys.has(key) || seenSeedKeys.has(key)) continue;
      seenSeedKeys.add(key);
      missing.push(row);
    }
  }
  return { files: seedFiles.map((f) => f.file), totalSeed, missing };
}

async function authorize() {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (!SPOT_ADMIN_ROLES.includes(user.role)) {
    return { error: NextResponse.json({ error: "権限がありません。" }, { status: 403 }) };
  }
  return { user };
}

/** シードファイルとの差分を確認する(プレビューのみ、DBは変更しない) */
export async function GET(request: Request) {
  const auth = await authorize();
  if (auth.error) return auth.error;

  const typeKey = new URL(request.url).searchParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const spotType = await resolveSpotType(typeKey);
  if (!spotType) {
    return NextResponse.json({ error: "存在しない種類です。" }, { status: 404 });
  }

  const { files, totalSeed, missing } = await diffSeedSpots(typeKey, spotType.id);
  return NextResponse.json({
    data: { files, totalSeed, missingCount: missing.length, missing },
  });
}

/** シードファイルのうち未登録の行だけをpublishedとして一括追加する */
export async function POST(request: Request) {
  const auth = await authorize();
  if (auth.error) return auth.error;
  const user = auth.user!;

  const typeKey = new URL(request.url).searchParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const spotType = await resolveSpotType(typeKey);
  if (!spotType) {
    return NextResponse.json({ error: "存在しない種類です。" }, { status: 404 });
  }

  const { missing } = await diffSeedSpots(typeKey, spotType.id);
  if (missing.length === 0) {
    return NextResponse.json({ data: { insertedCount: 0 } });
  }

  // 1件ずつのINSERT(数千回のラウンドトリップ)だと観光地シード規模(7,000件超)で
  // リクエストがタイムアウトするため、複数行VALUESのチャンクに分けて1トランザクションで
  // 投入する。レスポンスも全行を返さず件数のみ返す
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (let offset = 0; offset < missing.length; offset += INSERT_CHUNK_SIZE) {
      const chunk = missing.slice(offset, offset + INSERT_CHUNK_SIZE);
      const params: unknown[] = [spotType.id, user.id];
      const tuples = chunk.map((row) => {
        const base = params.length;
        params.push(
          row.name,
          row.name_kana,
          row.prefecture,
          row.municipality,
          row.lat,
          row.lng,
          row.rank,
          row.category,
          row.description
        );
        const placeholders = Array.from({ length: 9 }, (_, i) => `$${base + i + 1}`);
        return `($1, ${placeholders.join(", ")}, 'manual', 'published', $2)`;
      });
      await client.query(
        `insert into spots
          (spot_type_id, name, name_kana, prefecture, municipality, lat, lng, rank, category, description, source, status, created_by)
         values ${tuples.join(", ")}`,
        params
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "insert failed" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
  return NextResponse.json({ data: { insertedCount: missing.length } });
}
