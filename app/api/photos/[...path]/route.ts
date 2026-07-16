import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { parseVisitPhotoPath } from "@/lib/photos";

/**
 * 訪問記録の写真を配信する。写真は非公開のため、パスの先頭セグメント
 * (所有者のユーザーID)がログイン中のユーザーと一致する場合のみ返す。
 * 他人の写真・不正なパスは、存在の有無を漏らさないようすべて404にする。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { path: segments } = await params;
  const parsed = parseVisitPhotoPath(segments.join("/"));
  if (!parsed || parsed.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: Uint8Array<ArrayBuffer>;
  try {
    body = Uint8Array.from(await fs.readFile(parsed.absPath));
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type": parsed.contentType,
      // ファイル名がUUIDで内容が変わることはないため、ブラウザに長期キャッシュさせる
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
