import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser, getCurrentUserId } from "@/lib/auth/current-user";
import type { Spot } from "@/lib/types";

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const includeHidden = searchParams.get("includeHidden") === "1";

  const conditions = [
    "spot_type_id = (select active_spot_type_id from app_settings)",
  ];
  const params: unknown[] = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  if (!includeHidden) {
    // アクティブなスポット種類の hidden_ranks に含まれるランクは、明示的に
    // includeHidden=1 が指定されない限り返さない(大量の未整理データの遅延ロード用)
    const { rows: typeRows } = await query<{ hidden_ranks: string[] }>(
      `select t.hidden_ranks from spot_types t
       join app_settings s on s.active_spot_type_id = t.id`
    );
    const hiddenRanks = typeRows[0]?.hidden_ranks ?? [];
    if (hiddenRanks.length > 0) {
      params.push(hiddenRanks);
      conditions.push(`(rank is null or not (rank = any($${params.length})))`);
    }
  }

  const { rows } = await query<Spot>(
    `select * from spots where ${conditions.join(" and ")} order by prefecture, name`,
    params
  );

  return NextResponse.json({ data: rows });
}

interface SpotInput {
  name: string;
  name_kana: string | null;
  prefecture: string;
  municipality: string | null;
  lat: number;
  lng: number;
  rank: string | null;
  category: string | null;
  description: string | null;
  official_url: string | null;
}

async function insertSpot(
  spot: SpotInput,
  source: "manual" | "user_submitted",
  createdBy: string
) {
  const { rows } = await query<Spot>(
    `insert into spots
      (spot_type_id, name, name_kana, prefecture, municipality, lat, lng, rank, category, description, official_url, source, status, created_by)
     values ((select active_spot_type_id from app_settings), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12)
     returning *`,
    [
      spot.name,
      spot.name_kana,
      spot.prefecture,
      spot.municipality,
      spot.lat,
      spot.lng,
      spot.rank,
      spot.category,
      spot.description,
      spot.official_url,
      source,
      createdBy,
    ]
  );
  return rows[0];
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.role === "user") {
    return NextResponse.json(
      { error: "スポットを追加する権限がありません。" },
      { status: 403 }
    );
  }

  // 管理者・モデレーターのどちらの追加も一旦pendingとし、管理者の承認を経て公開する
  const source = user.role === "admin" ? "manual" : "user_submitted";

  const body = await request.json();
  const records: SpotInput[] = Array.isArray(body) ? body : [body];

  try {
    const inserted = [];
    for (const record of records) {
      inserted.push(await insertSpot(record, source, user.id));
    }
    return NextResponse.json({ data: Array.isArray(body) ? inserted : inserted[0] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "insert failed" },
      { status: 400 }
    );
  }
}
