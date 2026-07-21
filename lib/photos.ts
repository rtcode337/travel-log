import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

/**
 * 訪問記録の写真ファイル置き場(サーバー専用モジュール)。
 *
 * DBの visits.photos(text[])にはBase64ではなく、この置き場からの相対パス
 * 「<ユーザーID>/<年>/<月>/<uuid>.<拡張子>」を保存する。ユーザー×年月で
 * フォルダを振り分けるため、1フォルダにファイルが溜まりすぎて一覧表示が
 * 重くなることがなく、先頭セグメントがそのまま所有者チェックに使える
 * (配信は app/api/photos/[...path]/route.ts、非公開なので本人のみ)。
 *
 * docker-compose ではリポジトリ直下の ./photos をコンテナの /app/photos に
 * bindマウントする(開発・本番standaloneともにcwdは/app)。
 */
const PHOTOS_DIR = process.env.PHOTOS_DIR ?? path.join(process.cwd(), "photos");

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

// クライアント側(VisitFormModal)は1280px程度に縮小してから送るが、それを信頼せず
// サーバー側でも上限を設ける(ブラウザを経由しない直接APIコールでの
// ディスク圧迫・DoSを防ぐため)。1visitあたりの枚数上限は app/api/visits/route.ts 側
const MAX_PHOTO_BASE64_LENGTH = 8_000_000; // base64で約8MB(デコード後 約6MB)

// saveVisitPhotoが生成する相対パスにのみ一致する。DB由来の値であっても
// ファイルシステムに触る前に必ずこれで検証する(パストラバーサル対策)
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PHOTO_PATH_RE = new RegExp(
  `^(${UUID_RE})/\\d{4}/\\d{2}/${UUID_RE}\\.(jpg|png|webp)$`
);

export interface ParsedPhotoPath {
  /** パスの所有者(先頭セグメントのユーザーID) */
  userId: string;
  absPath: string;
  contentType: string;
}

/** 相対パスを検証し、所有者・絶対パス・Content-Typeに解決する。不正なパスはnull */
export function parseVisitPhotoPath(relPath: string): ParsedPhotoPath | null {
  const match = PHOTO_PATH_RE.exec(relPath);
  if (!match) return null;
  const ext = match[2];
  return {
    userId: match[1],
    absPath: path.join(PHOTOS_DIR, relPath),
    contentType: CONTENT_TYPE_BY_EXT[ext],
  };
}

/**
 * ブラウザから送られたdata URL(クライアント側で縮小・圧縮済み)をファイルに
 * 保存し、DBに入れる相対パスを返す。data URL以外・未対応の画像形式はエラー
 */
export async function saveVisitPhoto(
  userId: string,
  dataUrl: string
): Promise<string> {
  if (dataUrl.length > MAX_PHOTO_BASE64_LENGTH) {
    throw new Error("画像サイズが大きすぎます。");
  }
  const match = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(
    dataUrl
  );
  if (!match) throw new Error("data URL形式の画像ではありません");
  const ext = EXT_BY_MIME[match[1]];
  if (!ext) throw new Error(`未対応の画像形式です: ${match[1]}`);

  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const relPath = `${userId}/${year}/${month}/${randomUUID()}.${ext}`;

  const absPath = path.join(PHOTOS_DIR, relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, Buffer.from(match[2], "base64"));
  return relPath;
}

/**
 * visits.photosの値からファイルを削除する。パスとして解釈できない値や既に
 * 存在しないファイルは黙ってスキップする(訪問記録の削除自体は妨げない)
 */
export async function deleteVisitPhotos(photos: string[]): Promise<void> {
  await Promise.all(
    photos.map(async (relPath) => {
      const parsed = parseVisitPhotoPath(relPath);
      if (!parsed) return;
      await fs.unlink(parsed.absPath).catch(() => {});
    })
  );
}
