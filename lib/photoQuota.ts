import { formatBytes } from "@/lib/bytes";
import { query } from "@/lib/db";
import { photoStorage } from "@/lib/photoStorage";

/**
 * ユーザーごとの写真の容量の上限と使用量(サーバー専用)。
 *
 * 上限は**管理画面で変える**アプリ全体の設定(`app_settings.photo_quota_mb`。MB、既定102400=100GB。
 * **0で上限なし**)。保存先の容量は全員で分け合うもので、1人が際限なく足すと他の人の
 * 写真まで保存できなくなるため。環境変数にしないのは、変えるたびに再起動が要るから。
 *
 * **使用量はDBに数を持たず、保存先の実物を数える**(`photoStorage.usage`)。数を持つと
 * 保存・削除のたびに合わせ直す必要があり、ずれたら直す手段が無い。導入前に保存した
 * 写真もそのまま数えられる。
 */

const MB = 1024 * 1024;

/** 列が読めないとき(行が無いなど)の上限。スキーマの既定と同じ */
const DEFAULT_QUOTA_MB = 102400;

/** 上限(MB)。0は上限なし */
export async function getPhotoQuotaMb(): Promise<number> {
  const { rows } = await query<{ photo_quota_mb: number }>(
    "select photo_quota_mb from app_settings"
  );
  return rows[0]?.photo_quota_mb ?? DEFAULT_QUOTA_MB;
}

/** 上限(バイト)。nullは上限なし */
async function getPhotoQuotaBytes(): Promise<number | null> {
  const mb = await getPhotoQuotaMb();
  return mb > 0 ? mb * MB : null;
}

export interface PhotoUsageSummary {
  usedBytes: number;
  photoCount: number;
  /** null は上限なし */
  quotaBytes: number | null;
}

export async function getPhotoUsage(userId: string): Promise<PhotoUsageSummary> {
  const [{ bytes, count }, quotaBytes] = await Promise.all([
    photoStorage.usage(`${userId}/`),
    getPhotoQuotaBytes(),
  ]);
  return { usedBytes: bytes, photoCount: count, quotaBytes };
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
  if (newDataUrls.length === 0) return null;
  const { usedBytes, quotaBytes } = await getPhotoUsage(userId);
  if (quotaBytes === null) return null;
  const adding = newDataUrls.reduce((n, u) => n + dataUrlBytes(u), 0);
  if (usedBytes + adding <= quotaBytes) return null;
  return (
    `写真の容量の上限(${formatBytes(quotaBytes)})を超えます。` +
    `いまの使用量は${formatBytes(usedBytes)}、追加しようとした写真は${formatBytes(adding)}です。` +
    "不要な写真を外してから保存してください。"
  );
}
