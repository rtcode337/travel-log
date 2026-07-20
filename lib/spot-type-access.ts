import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSpotTypeSetting, SPOT_ADMIN_ROLES, type SpotType } from "@/lib/types";
import { SPOT_TYPE_SELECT } from "@/lib/spot-types-query";

/**
 * /[type]/map・/[type]/spots・/[type]/account 共通の表示可否チェック。
 * public_visible設定がfalse(既定)ならadmin/spot_adminのみ閲覧できる
 * (/[type]/adminはここを通さず常にアクセス可。設定を変える手段を自ら塞がないため)。
 */
export async function canViewSpotType(typeKey: string): Promise<boolean> {
  const { rows } = await query<Pick<SpotType, "settings">>(
    `${SPOT_TYPE_SELECT} where t.key = $1`,
    [typeKey]
  );
  if (!rows[0]) return false;
  if (getSpotTypeSetting(rows[0], "public_visible")) return true;
  const user = await getCurrentUser();
  return !!user && SPOT_ADMIN_ROLES.includes(user.role);
}
