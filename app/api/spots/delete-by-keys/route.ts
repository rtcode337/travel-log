import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteVisitPhotos } from "@/lib/photos";

/** 1リクエストで受け付けるキーの上限(貼り付けミスで巨大な本文が来るのを防ぐ) */
const MAX_KEYS = 20000;

async function resolveSpotType(typeKey: string) {
  const { rows } = await query<{ id: string }>(
    "select id from spot_types where key = $1",
    [typeKey]
  );
  return rows[0] ?? null;
}

/**
 * キー一覧を指定しての公開スポットの一括削除。travel-log-data側で
 * 「場所ではない記事」等を除外した際に、その`key`の一覧
 * (`<スポットキー>/*_excluded_candidates/exclude.txt`)を貼り付けて
 * DBからも消すための機能。
 *
 * 公開スポットの全削除(purge)と同様、他ユーザーの訪問記録・写真を巻き込んで
 * 消すためadmin専用とする(spot_adminは不可)。
 */
async function authorize() {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (user.role !== "admin") {
    return { error: NextResponse.json({ error: "権限がありません。" }, { status: 403 }) };
  }
  return { user };
}

function parseKeys(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const keys = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (trimmed) keys.add(trimmed);
  }
  return [...keys];
}

/**
 * 指定キーに一致する公開スポットを削除する。`dryRun`のときはDBを変更せず、
 * 一致した件数とキーだけを返す。
 *
 * 一致は`spots.key`が第一で、keyが未設定(null)の既存行に限り`name`の完全一致も
 * 拾う。keyを振る前に取り込んだデータ(観光地の初回投入分など)をキーの一覧だけで
 * 掃除できるようにするための後方互換で、travel-log-data側のkeyは
 * 「スポット名(重複時のみ連番サフィックス)」の規則で振ってあるため名前で引ける。
 *
 * 一致しないキーはエラーにせず`notFoundKeys`として返すだけにする(除外リストは
 * 追記していく運用のため、既に消したキーが何度も含まれる)。
 */
export async function POST(request: Request) {
  const auth = await authorize();
  if (auth.error) return auth.error;

  const typeKey = new URL(request.url).searchParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const spotType = await resolveSpotType(typeKey);
  if (!spotType) {
    return NextResponse.json({ error: "存在しない種別です。" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 400 });
  }
  const payload = (body ?? {}) as { keys?: unknown; dryRun?: unknown };
  const keys = parseKeys(payload.keys);
  if (!keys) {
    return NextResponse.json(
      { error: "keys(文字列の配列)が必要です。" },
      { status: 400 }
    );
  }
  if (keys.length === 0) {
    return NextResponse.json(
      { error: "削除するキーが1件もありません。" },
      { status: 400 }
    );
  }
  if (keys.length > MAX_KEYS) {
    return NextResponse.json(
      { error: `キーは一度に${MAX_KEYS}件までです。` },
      { status: 400 }
    );
  }
  const dryRun = payload.dryRun === true;

  /** 一致条件($1=spot_type_id, $2=keys)。テーブル別名を差し替えて使い回す */
  const matchCondition = (alias: string) =>
    `${alias}spot_type_id = $1 and ${alias}status = 'published'
       and (${alias}key = any($2::text[])
            or (${alias}key is null and ${alias}name = any($2::text[])))`;

  const matched = await query<{ id: string; key: string | null; name: string }>(
    `select id, key, name from spots where ${matchCondition("")}`,
    [spotType.id, keys]
  );
  const matchedKeys = new Set(matched.rows.map((r) => r.key ?? r.name));
  const notFoundKeys = keys.filter((k) => !matchedKeys.has(k));

  if (dryRun) {
    return NextResponse.json({
      data: {
        matchedCount: matched.rows.length,
        notFoundKeys,
        sampleNames: matched.rows.slice(0, 20).map((r) => r.name),
      },
    });
  }

  const client = await pool.connect();
  let photoRows: { photos: string[] }[] = [];
  let deletedCount = 0;
  try {
    await client.query("begin");
    // 写真ファイルはvisitsがカスケードで消える前に集めておく(purgeと同じ手順)
    const photoResult = await client.query<{ photos: string[] }>(
      `select v.photos from visits v
       join spots s on v.spot_id = s.id
       where ${matchCondition("s.")}`,
      [spotType.id, keys]
    );
    photoRows = photoResult.rows;
    const { rowCount } = await client.query(
      `delete from spots where ${matchCondition("")}`,
      [spotType.id, keys]
    );
    deletedCount = rowCount ?? 0;
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 }
    );
  } finally {
    client.release();
  }

  await deleteVisitPhotos(photoRows.flatMap((r) => r.photos));
  return NextResponse.json({ data: { deletedCount, notFoundKeys } });
}
