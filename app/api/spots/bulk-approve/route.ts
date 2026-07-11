import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { Spot } from "@/lib/types";

/** 承認待ちスポットをまとめて公開する(CSVインポート等でpendingが大量に溜まった場合用) */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { rows } = await query<Spot>(
    "update spots set status = 'published' where status = 'pending' returning *"
  );
  return NextResponse.json({ data: rows });
}
