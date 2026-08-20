import { promises as fs } from "fs";
import path from "path";

/**
 * 訪問記録エクスポートのZIPの置き場(サーバー専用モジュール)。
 *
 * docker-composeはデータの置き場(data/)を /data にbindマウントし、この置き場を
 * EXPORTS_DIR=/data/exports で渡す。写真(data/photos)と分けてあるのは寿命が違うため ——
 * 写真は消したら戻らない記録、ZIPはいつでも作り直せる使い捨てで、
 * 同じユーザーのものは最新1件だけ残して消す。混ぜると、掃除のときに
 * 消してよいものと消してはいけないものが同じ場所に並ぶ。
 *
 * 写真(lib/photoStorage.ts)と違いローカルFSのみ。ZIPは生成に時間がかかる
 * バックグラウンド処理の成果物で、そもそも永続ディスクを持てない環境
 * (PHOTO_STORAGE=supabase を使うようなホスト)では機能自体が成立しない。
 */

/** ZIPの保存先ディレクトリ(既定はcwd直下のexports) */
const EXPORTS_DIR = process.env.EXPORTS_DIR ?? path.join(process.cwd(), "exports");

/**
 * 相対パスを実パスへ。`..`でディレクトリの外へ出る指定は弾く
 * (相対パスはDB由来だが、経路を1か所に絞って安全側に倒しておく)
 */
function resolveExportPath(relPath: string): string | null {
  const absPath = path.resolve(EXPORTS_DIR, relPath);
  const root = path.resolve(EXPORTS_DIR);
  if (absPath !== root && !absPath.startsWith(root + path.sep)) return null;
  return absPath;
}

/** ZIPを保存する(既存があれば上書き) */
export async function saveExportZip(
  relPath: string,
  data: Uint8Array
): Promise<void> {
  const absPath = resolveExportPath(relPath);
  if (!absPath) throw new Error("invalid export path");
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, data);
}

/** ZIPを読む。存在しない・読めない場合はnull(ファイルだけ消えていても画面は壊さない) */
export async function readExportZip(relPath: string): Promise<Buffer | null> {
  const absPath = resolveExportPath(relPath);
  if (!absPath) return null;
  try {
    return await fs.readFile(absPath);
  } catch {
    return null;
  }
}

/** ZIPを削除する。存在しなくてもエラーにしない */
export async function deleteExportZip(relPath: string): Promise<void> {
  const absPath = resolveExportPath(relPath);
  if (!absPath) return;
  try {
    await fs.unlink(absPath);
  } catch {
    // 既に無い・権限が無い等は無視する(行を消せなくなるほうが困る)
  }
}
