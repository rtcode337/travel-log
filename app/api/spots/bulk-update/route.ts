import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_ADMIN_ROLES, type Spot, type SpotType } from "@/lib/types";
import { SPOT_TYPE_SELECT } from "@/lib/spot-types-query";
import { parseRank } from "@/lib/rank";

interface BulkUpdateRecord {
  id: string;
  name: string;
  name_kana: string | null;
  lat: number;
  lng: number;
  region: string;
  rank?: string | null;
  series: string | null;
  /** 含まれるときだけ更新(PATCH /api/spots/[id]と同じ扱い) */
  categories?: string[] | null;
  description: string | null;
  /** 含まれるときだけ更新(同上) */
  key?: string | null;
  /** 含まれるときだけ更新(同上) */
  origin?: string;
}

/**
 * CSVインポートの上書き更新用の一括PATCH。1件ずつのPATCH /api/spots/[id]を
 * 大量に繰り返すとラウンドトリップの積み重ねで重いため、POST /api/spots(unnestの
 * 一括INSERT)と対で、更新も1回のUPDATEにまとめる。
 *
 * 対象は指定種別の公開(published)スポットのみ(CSVインポートの上書きルールと同じ。
 * 公開スポットの編集権限に合わせてspot_admin/admin専用)。id・種別・statusが
 * 合わない行は黙ってスキップし、実際に更新できた行だけを返す(呼び出し側が
 * 件数の食い違いを検知できる)。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!SPOT_ADMIN_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const typeKey = new URL(request.url).searchParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const { rows: typeRows } = await query<SpotType>(
    `${SPOT_TYPE_SELECT} where t.key = $1`,
    [typeKey]
  );
  // 呼び出しはspot_admin/admin限定のため、public_visible(非公開種別を一般に
  // 見せない)の追加チェックは不要
  const spotType = typeRows[0];
  if (!spotType) {
    return NextResponse.json({ error: "存在しない種別です。" }, { status: 404 });
  }

  const body = await request.json();
  if (!Array.isArray(body) || body.length === 0) {
    return NextResponse.json(
      { error: "更新するスポットの配列を送ってください。" },
      { status: 400 }
    );
  }
  const records = body as BulkUpdateRecord[];

  // key/categories/originは「ボディに含まれるときだけ更新」(単体PATCHと同じ理由。
  // CSVに列が無いときに既存値をnull・空で消さないため)。行ごとに有無が違えるよう
  // boolean列で渡す
  const hasCategories = records.map((r) =>
    Object.prototype.hasOwnProperty.call(r, "categories")
  );
  const hasKey = records.map((r) => Object.prototype.hasOwnProperty.call(r, "key"));
  const hasOrigin = records.map((r) =>
    Object.prototype.hasOwnProperty.call(r, "origin")
  );
  const invalidOrigin = records.find(
    (r, i) => hasOrigin[i] && r.origin !== "csv" && r.origin !== "manual"
  );
  if (invalidOrigin) {
    return NextResponse.json(
      { error: `origin「${invalidOrigin.origin}」は指定できません。` },
      { status: 400 }
    );
  }

  try {
    // categoriesはPOST /api/spotsのINSERTと同じく、1件分を1つのJSON配列に
    // まとめたjsonb[]で渡してSQL側でtext[]に開く(要素数が行ごとに異なるため)
    const { rows } = await query<Spot>(
      `update spots s set
        name = u.name, name_kana = u.name_kana, lat = u.lat, lng = u.lng,
        region = u.region, rank = u.rank, series = u.series, description = u.description,
        categories = case when u.has_categories
          then array(select jsonb_array_elements_text(u.categories)) else s.categories end,
        key = case when u.has_key then u.key else s.key end,
        origin = case when u.has_origin then u.origin else s.origin end
       from unnest(
         $2::uuid[], $3::text[], $4::text[], $5::float8[], $6::float8[], $7::text[],
         $8::text[], $9::text[], $10::bool[], $11::jsonb[], $12::bool[], $13::text[],
         $14::bool[], $15::text[], $16::text[]
       ) as u(id, name, name_kana, lat, lng, region, series, description,
              has_categories, categories, has_key, key, has_origin, origin, rank)
       where s.id = u.id and s.spot_type_id = $1 and s.status = 'published'
       returning s.*`,
      [
        spotType.id,
        records.map((r) => r.id),
        records.map((r) => r.name),
        records.map((r) => r.name_kana),
        records.map((r) => r.lat),
        records.map((r) => r.lng),
        records.map((r) => r.region),
        records.map((r) => r.series),
        records.map((r) => r.description),
        hasCategories,
        records.map((r) => JSON.stringify(r.categories ?? [])),
        hasKey,
        records.map((r) => r.key ?? null),
        hasOrigin,
        records.map((r) => r.origin ?? null),
        records.map((r) => parseRank(r.rank)),
      ]
    );
    return NextResponse.json({ data: rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "update failed" },
      { status: 400 }
    );
  }
}
