import { redirect } from "next/navigation";
import { query } from "@/lib/db";

/**
 * ログイン後にどのスポット種別の地図を開くかは、管理画面で設定した
 * app_settings.active_spot_type_id(既定はtourist。アプリ初期化時に必ず存在する)で決まる。
 * 切替がすぐ反映されるよう、ビルド時に静的化せず常にリクエスト時に問い合わせる。
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const { rows } = await query<{ key: string }>(
    `select t.key from app_settings s
     join spot_types t on t.id = s.active_spot_type_id`
  );
  redirect(`/${rows[0]?.key ?? "tourist"}/map`);
}
