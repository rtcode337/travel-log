import { randomUUID } from "crypto";
import { photoStorage } from "@/lib/photoStorage";

/**
 * 訪問記録の写真(サーバー専用モジュール)。
 *
 * DBの visits.photos(text[])にはBase64ではなく、保存先からの相対パス
 * 「<ユーザーID>/<年>/<月>/<uuid>.<拡張子>」を保存する。ユーザー×年月で
 * フォルダを振り分けるため、1フォルダにファイルが溜まりすぎて一覧表示が
 * 重くなることがなく、先頭セグメントがそのまま所有者チェックに使える
 * (配信は app/api/photos/[...path]/route.ts、非公開なので本人のみ)。
 *
 * 実際の読み書き先(ローカルFS / Supabase Storage)は`lib/photoStorage.ts`が
 * `PHOTO_STORAGE`環境変数で切り替える。このモジュールはパスの生成・検証と
 * data URLのデコードだけを受け持ち、保存先そのものには依存しない。
 */

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
// 保存先に触る前に必ずこれで検証する(パストラバーサル対策)
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PHOTO_PATH_RE = new RegExp(
  `^(${UUID_RE})/\\d{4}/\\d{2}/${UUID_RE}\\.(jpg|png|webp)$`
);

export interface ParsedPhotoPath {
  /** パスの所有者(先頭セグメントのユーザーID) */
  userId: string;
  /** 検証済みの相対パス(そのまま`photoStorage`に渡せる) */
  relPath: string;
  contentType: string;
}

/** 相対パスを検証し、所有者・相対パス・Content-Typeに解決する。不正なパスはnull */
export function parseVisitPhotoPath(relPath: string): ParsedPhotoPath | null {
  const match = PHOTO_PATH_RE.exec(relPath);
  if (!match) return null;
  return {
    userId: match[1],
    relPath,
    contentType: CONTENT_TYPE_BY_EXT[match[2]],
  };
}

/**
 * ブラウザから送られたdata URL(クライアント側で縮小・圧縮済み)を保存し、
 * DBに入れる相対パスを返す。data URL以外・未対応の画像形式はエラー
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
  const contentType = match[1];
  const ext = EXT_BY_MIME[contentType];
  if (!ext) throw new Error(`未対応の画像形式です: ${contentType}`);

  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const relPath = `${userId}/${year}/${month}/${randomUUID()}.${ext}`;

  await photoStorage.put(
    relPath,
    Uint8Array.from(Buffer.from(match[2], "base64")),
    contentType
  );
  return relPath;
}

/**
 * 検証済みの相対パスから写真の中身を読む。不正なパス・存在しない場合はnull
 * (配信ルートとZIPエクスポートで共用)
 */
export async function readVisitPhoto(
  relPath: string
): Promise<Uint8Array<ArrayBuffer> | null> {
  const parsed = parseVisitPhotoPath(relPath);
  if (!parsed) return null;
  return photoStorage.get(parsed.relPath);
}

/**
 * visits.photosの値から写真を削除する。パスとして解釈できない値や既に
 * 存在しないものは黙ってスキップする(訪問記録の削除自体は妨げない)
 */
export async function deleteVisitPhotos(photos: string[]): Promise<void> {
  await Promise.all(
    photos.map(async (relPath) => {
      const parsed = parseVisitPhotoPath(relPath);
      if (!parsed) return;
      await photoStorage.delete(parsed.relPath);
    })
  );
}
