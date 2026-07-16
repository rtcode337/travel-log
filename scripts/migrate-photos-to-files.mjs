#!/usr/bin/env node
// 旧方式(visits.photos列にBase64のdata URLを直接保存)のデータを、photosフォルダへの
// ファイル保存方式に移行するスクリプト。lib/photos.tsと同じ
// 「<ユーザーID>/<年>/<月>/<uuid>.<拡張子>」の相対パスで保存し(年月はその訪問記録の
// created_atを使う)、DBの値をそのパスに書き換える。
//
// 使い方(README「写真の保存先とデータ移行」参照):
//   DATABASE_URL=postgres://... PHOTOS_DIR=./photos node scripts/migrate-photos-to-files.mjs
//
// data URLの要素だけを変換するため、何度実行しても安全(冪等)。
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import pg from "pg";

const PHOTOS_DIR = process.env.PHOTOS_DIR ?? path.join(process.cwd(), "photos");

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

async function saveDataUrl(userId, createdAt, dataUrl) {
  const match = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("data URLとして解釈できません");
  const ext = EXT_BY_MIME[match[1]];
  if (!ext) throw new Error(`未対応の画像形式です: ${match[1]}`);

  const year = String(createdAt.getFullYear());
  const month = String(createdAt.getMonth() + 1).padStart(2, "0");
  const relPath = `${userId}/${year}/${month}/${randomUUID()}.${ext}`;

  const absPath = path.join(PHOTOS_DIR, relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, Buffer.from(match[2], "base64"));
  return relPath;
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const { rows } = await pool.query(
  `select id, user_id, created_at, photos from visits
   where exists (select 1 from unnest(photos) p where p like 'data:%')
   order by created_at`
);

console.log(`移行対象の訪問記録: ${rows.length}件(保存先: ${PHOTOS_DIR})`);

let migratedPhotos = 0;
let failedPhotos = 0;
for (const visit of rows) {
  const converted = [];
  for (const photo of visit.photos) {
    if (!photo.startsWith("data:")) {
      converted.push(photo); // 変換済み(相対パス)はそのまま
      continue;
    }
    try {
      converted.push(await saveDataUrl(visit.user_id, visit.created_at, photo));
      migratedPhotos++;
    } catch (e) {
      console.warn(`  訪問記録 ${visit.id} の写真を変換できませんでした: ${e.message}(元の値を残します)`);
      converted.push(photo);
      failedPhotos++;
    }
  }
  await pool.query("update visits set photos = $1 where id = $2", [
    converted,
    visit.id,
  ]);
}

console.log(`完了: 写真${migratedPhotos}枚をファイルへ移行しました` + (failedPhotos ? `(${failedPhotos}枚は変換できず元の値のまま)` : ""));
await pool.end();
