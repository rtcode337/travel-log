import { api } from "@/lib/api-client";
import type { SpotType } from "@/lib/types";

/**
 * spotTypeKey指定時はそのキーのスポット種類、未指定ならapp_settingsの
 * 既定(管理画面で選んだ種類)を返す。MapView/SpotsViewの両方で使う。
 */
export async function resolveActiveType(
  spotTypeKey?: string
): Promise<SpotType | null> {
  if (spotTypeKey) {
    const { data } = await api.spotTypes.list();
    return data?.find((t) => t.key === spotTypeKey) ?? null;
  }
  const { data } = await api.appSettings.get();
  return data;
}
