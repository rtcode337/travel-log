import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { formatBytes } from "@/lib/bytes";

test("data URL から中身のバイト数を見積もる(base64の詰め物を除く)", async () => {
  const { dataUrlBytes } = await import("@/lib/photoQuota");
  for (const n of [1, 2, 3, 100, 12345]) {
    const url = `data:image/jpeg;base64,${Buffer.alloc(n, 7).toString("base64")}`;
    assert.equal(dataUrlBytes(url), n);
  }
});

test("容量の表示はKB/MBで出す", () => {
  assert.equal(formatBytes(512 * 1024), "512KB");
  assert.equal(formatBytes(1.5 * 1024 * 1024), "1.5MB");
  assert.equal(formatBytes(300 * 1024 * 1024), "300MB");
});

// 保存先の実物を数える(年/月の下まで降りる)。他人のぶんは数えない
test("ユーザーの写真の合計と枚数を数える", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "photos-"));
  try {
    process.env.PHOTOS_DIR = dir;
    const { photoStorage } = await import("@/lib/photoStorage");
    await mkdir(path.join(dir, "u1/2026/10"), { recursive: true });
    await mkdir(path.join(dir, "u1/2025/01"), { recursive: true });
    await mkdir(path.join(dir, "u2/2026/10"), { recursive: true });
    await writeFile(path.join(dir, "u1/2026/10/a.jpg"), Buffer.alloc(1000));
    await writeFile(path.join(dir, "u1/2025/01/b.jpg"), Buffer.alloc(234));
    await writeFile(path.join(dir, "u2/2026/10/c.jpg"), Buffer.alloc(9999));
    assert.deepEqual(await photoStorage.usage("u1/"), { bytes: 1234, count: 2 });
    assert.deepEqual(await photoStorage.usage("nobody/"), { bytes: 0, count: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
