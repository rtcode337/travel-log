import { test } from "node:test";
import assert from "node:assert/strict";
import { ZipWriter } from "@/lib/zip";
import { readZip, zipText } from "@/lib/zipReader";

// 書き出し(エクスポート)と読み取り(取り込み)を突き合わせる
test("ZipWriterで書いたものをzipReaderで読み戻せる", async () => {
  const chunks: Buffer[] = [];
  const zip = new ZipWriter(async (chunk) => {
    chunks.push(chunk);
  });
  await zip.add("visits-tourist.csv", Buffer.from("﻿スポット名\n清水寺\n", "utf8"));
  const photo = Buffer.alloc(100_000, 7);
  await zip.add("photos/a.jpg", photo);
  const size = await zip.finish();

  const data = Buffer.concat(chunks);
  assert.equal(size, data.length);
  const entries = await readZip(new Blob([data]));
  assert.deepEqual([...entries.keys()].sort(), ["photos/a.jpg", "visits-tourist.csv"]);
  assert.match(zipText(entries, "visits-tourist.csv") ?? "", /清水寺/);
  assert.equal(entries.get("photos/a.jpg")?.length, photo.length);
});
