import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getPhotoQuotaMb } from "@/lib/photoQuota";

/**
 * ユーザーごとの写真の容量の上限(`app_settings.photo_quota_mb`。MB、0は上限なし)。
 * 管理画面から読み書きする(admin専用。保存先の容量の配分は全員に効くため)
 */
async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return NextResponse.json({ data: { quotaMb: await getPhotoQuotaMb() } });
}

export async function PATCH(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const quotaMb = body?.quotaMb;
  // 上はintegerの範囲まで(それ以上は事実上の上限なしなので0を使ってもらう)
  if (!Number.isInteger(quotaMb) || quotaMb < 0 || quotaMb > 2_000_000_000) {
    return NextResponse.json(
      { error: "上限は0以上の整数(MB)で指定してください。0は上限なしです。" },
      { status: 400 }
    );
  }
  await query("update app_settings set photo_quota_mb = $1, updated_at = now()", [quotaMb]);
  return NextResponse.json({ data: { quotaMb } });
}
