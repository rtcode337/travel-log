import { formatBytes } from "@/lib/bytes";
import { photoStorage } from "@/lib/photoStorage";

/**
 * ユーザーごとの写真の容量の上限と使用量(サーバー専用)。
 *
 * 上限は環境変数`PHOTO_QUOTA_MB`(MB、既定1024=1GB。**0で上限なし**)。保存先の容量は
 * 全員で分け合うもので、1人が際限なく足すと他の人の写真まで保存できなくなるため。
 *
 * **使用量はDBに数を持たず、保存先の実物を数える**(`photoStorage.usage`)。数を持つと
 * 保存・削除のたびに合わせ直す必要があり、ずれたら直す手段が無い。導入前に保存した
 * 写真もそのまま数えられる。
 */

const MB = 1024 * 1024;

/** 上限(バイト)。nullは上限なし */
export const PHOTO_QUOTA_BYTES: number | null = (() => {
  const raw = process.env.PHOTO_QUOTA_MB;
  const mb = raw === undefined || raw.trim() === "" ? 1024 : Number(raw);
  return Number.isFinite(mb) && mb > 0 ? Math.floor(mb * MB) : null;
})();

export interface PhotoUsageSummary {
  usedBytes: number;
  photoCount: number;
  /** null は上限なし */
  quotaBytes: number | null;
}

export async function getPhotoUsage(userId: string): Promise<PhotoUsageSummary> {
  const { bytes, count } = await photoStorage.usage(`${userId}/`);
  return { usedBytes: bytes, photoCount: count, quotaBytes: PHOTO_QUOTA_BYTES };
}

/** data URL(base64)の中身のバイト数。保存前に足し込み後の使用量を見積もるため */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * 新しく保存する写真(data URL)を足すと上限を超えるなら、利用者に見せる理由を返す。
 * 収まる・上限なしならnull。**保存する前に呼ぶ**(保存してから消すと、途中で落ちたときに残る)
 */
export async function photoQuotaError(
  userId: string,
  newDataUrls: string[]
): Promise<string | null> {
  if (PHOTO_QUOTA_BYTES === null || newDataUrls.length === 0) return null;
  const adding = newDataUrls.reduce((n, u) => n + dataUrlBytes(u), 0);
  const { usedBytes } = await getPhotoUsage(userId);
  if (usedBytes + adding <= PHOTO_QUOTA_BYTES) return null;
  return (
    `写真の容量の上限(${formatBytes(PHOTO_QUOTA_BYTES)})を超えます。` +
    `いまの使用量は${formatBytes(usedBytes)}、追加しようとした写真は${formatBytes(adding)}です。` +
    "不要な写真を外してから保存してください。"
  );
}
