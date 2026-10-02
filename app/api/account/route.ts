import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteUserAccount, LastAdminError } from "@/lib/deleteUserAccount";
import { SESSION_COOKIE } from "@/lib/auth/session";

// 写真が多いユーザーではファイルの削除に時間がかかるため、既定(10秒)では足りない
// (Vercelのサーバーレス関数の上限。指定の無いホストでは無視される)
export const maxDuration = 60;

/**
 * アカウント削除(本人による自分のアカウントの削除)。消えるもの・残るものは
 * `lib/deleteUserAccount.ts`(管理者による削除`/api/admin/users/[id]`と共用)。
 *
 * **最後の管理者は消せない** —— 自分でアカウントを削除して誰も管理画面に
 * 入れなくなるのを防ぐため。
 */
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await deleteUserAccount(user.id);
  } catch (err) {
    if (err instanceof LastAdminError) {
      return NextResponse.json(
        {
          error:
            "最後の管理者はアカウントを削除できません。先に別のユーザーを管理者にしてください。",
        },
        { status: 400 }
      );
    }
    console.error("アカウントの削除に失敗しました", err);
    return NextResponse.json(
      { error: "アカウントの削除に失敗しました。" },
      { status: 500 }
    );
  }

  // 消えたユーザーのセッションを残さない
  const response = NextResponse.json({ data: { ok: true } });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
