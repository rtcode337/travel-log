import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getPhotoUsage } from "@/lib/photoQuota";

/** 自分の写真の使用量と上限(アカウント画面に出す) */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ data: await getPhotoUsage(userId) });
  } catch (e) {
    console.error("写真の使用量を数えられませんでした", e);
    return NextResponse.json(
      { error: "写真の使用量を取得できませんでした。" },
      { status: 502 }
    );
  }
}
