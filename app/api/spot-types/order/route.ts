import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_TYPE_ORDER, SPOT_TYPE_SELECT } from "@/lib/spot-types-query";
import type { SpotType } from "@/lib/types";

/**
 * スポット種別の並び順を、渡されたIDの順で置き換える(admin専用)。
 *
 * **1回のリクエストで全部を並べ直す**。1件ずつPATCHすると、途中で失敗したときに
 * 並びが中途半端になるうえ、順番の意味(何番目か)が1件だけでは決まらない。
 * 渡されなかった種別は末尾に回る(sort_orderを大きくするのではなく、
 * 渡された分だけを0からの連番にする ——「一覧に出ている分で置き換える」流儀は
 * 訪問予定リストの経由スポットと同じ)。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json();
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((v: unknown): v is string => typeof v === "string")
    : [];
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "並び順(ids)を指定してください。" },
      { status: 400 }
    );
  }

  // 渡された順を0からの連番にする。存在しないIDは黙って無視される
  // (with ordinality の join が空振りするだけ)
  await query(
    `update spot_types t
        set sort_order = ord.seq - 1
       from unnest($1::uuid[]) with ordinality as ord(id, seq)
      where t.id = ord.id`,
    [ids]
  );
  // 渡されなかった種別(別のタブで追加された等)は末尾へ寄せる
  await query(
    `update spot_types set sort_order = $1 where not (id = any($2::uuid[]))`,
    [ids.length, ids]
  );

  const { rows } = await query<SpotType>(`${SPOT_TYPE_SELECT} ${SPOT_TYPE_ORDER}`);
  return NextResponse.json({ data: rows });
}
