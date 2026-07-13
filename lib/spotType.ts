import { api } from "@/lib/api-client";
import type { SpotType } from "@/lib/types";

/**
 * 指定したキーのスポット種類を返す(MapView/SpotsViewの両方で使う)。
 * このアプリのURLは必ず /[type]/... 経由なので、キー未指定のケースは扱わない。
 */
export async function resolveActiveType(
  spotTypeKey: string
): Promise<SpotType | null> {
  const { data } = await api.spotTypes.list();
  return data?.find((t) => t.key === spotTypeKey) ?? null;
}
