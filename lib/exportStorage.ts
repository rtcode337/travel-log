import { createReadStream, promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { ZipWriter } from "@/lib/zip";

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

/**
 * ZIPを書き出す(既存があれば上書き)。`build`がエントリを1件ずつ足し、そのたびに
 * ファイルへ書く —— 全体をメモリに組まない(写真の多いユーザーでは数百MBになる)。
 *
 * **書き終わるまでは`.part`に書き、最後に名前を変える。** 途中で落ちたときに、
 * 壊れたZIPが完成品の名前で残らないようにするため。返すのはZIPのバイト数。
 */
export async function writeExportZip(
  relPath: string,
  build: (zip: ZipWriter) => Promise<void>
): Promise<number> {
  const absPath = resolveExportPath(relPath);
  if (!absPath) throw new Error("invalid export path");
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const partPath = `${absPath}.part`;
  const handle = await fs.open(partPath, "w");
  try {
    const zip = new ZipWriter(async (chunk) => {
      await handle.write(chunk);
    });
    await build(zip);
    const size = await zip.finish();
    await handle.close();
    await fs.rename(partPath, absPath);
    return size;
  } catch (e) {
    await handle.close().catch(() => {});
    await fs.unlink(partPath).catch(() => {});
    throw e;
  }
}

/**
 * ZIPを読み出すストリームとバイト数。存在しない・読めない場合はnull
 * (ファイルだけ消えていても画面は壊さない)。中身はメモリに載せずに流す
 */
export async function openExportZip(
  relPath: string
): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
  const absPath = resolveExportPath(relPath);
  if (!absPath) return null;
  try {
    const { size } = await fs.stat(absPath);
    const stream = Readable.toWeb(createReadStream(absPath)) as ReadableStream<Uint8Array>;
    return { stream, size };
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

/**
 * あるユーザーのZIPを置き場ごと消す(ZIPは`<ユーザーID>/<ジョブID>.zip`に置く)。
 * 行の`file_path`から消すだけでは、保存の直後に落ちて行へ書き戻せなかったZIPが残るので、
 * アカウントを消すときはディレクトリごと消す。存在しなくてもエラーにしない
 */
export async function deleteUserExportZips(userId: string): Promise<void> {
  const absPath = resolveExportPath(userId);
  // 置き場そのもの(空のID)は消さない
  if (!absPath || absPath === path.resolve(EXPORTS_DIR)) return;
  await fs.rm(absPath, { recursive: true, force: true }).catch(() => {});
}
