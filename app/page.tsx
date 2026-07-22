import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { canViewSpotType } from "@/lib/spot-type-access";
import { LAST_SPOT_TYPE_COOKIE } from "@/lib/last-spot-type";

/**
 * ログイン後にどのスポット種別の地図を開くかは、最後に開いていた種別のCookie
 * (middleware.tsが書き込む。lib/last-spot-type.ts参照)を最優先し、無い・
 * 開けない(種別の削除や非公開化・ロール変更後など)場合は管理画面で設定した
 * app_settings.active_spot_type_id(既定はtourist。アプリ初期化時に必ず存在する)に
 * フォールバックする。切替がすぐ反映されるよう、ビルド時に静的化せず常に
 * リクエスト時に問い合わせる。
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const lastKey = (await cookies()).get(LAST_SPOT_TYPE_COOKIE)?.value;
  if (lastKey && (await canViewSpotType(lastKey))) {
    redirect(`/${lastKey}/map`);
  }

  const { rows } = await query<{ key: string }>(
    `select t.key from app_settings s
     join spot_types t on t.id = s.active_spot_type_id`
  );
  redirect(`/${rows[0]?.key ?? "tourist"}/map`);
}
