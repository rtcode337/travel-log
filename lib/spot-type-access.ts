import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_ADMIN_ROLES, type SpotTypeVisibility } from "@/lib/types";

/**
 * /[type]/map・/[type]/spots・/[type]/account 共通の表示可否チェック。
 * disabledは全員404、admin_onlyはadmin/spot_adminのみ閲覧できる
 * (/[type]/adminはここを通さず常にアクセス可。無効化した種類を再有効化できなくなるため)。
 */
export async function canViewSpotType(typeKey: string): Promise<boolean> {
  const { rows } = await query<{ visibility: SpotTypeVisibility }>(
    "select visibility from spot_types where key = $1",
    [typeKey]
  );
  if (!rows[0] || rows[0].visibility === "disabled") return false;
  if (rows[0].visibility === "public") return true;
  const user = await getCurrentUser();
  return !!user && SPOT_ADMIN_ROLES.includes(user.role);
}
