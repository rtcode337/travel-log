import { test } from "node:test";
import assert from "node:assert/strict";

import { createSessionToken, verifySessionToken } from "@/lib/auth/session";

// 鍵は呼び出しのたびに環境変数から読まれるので、ここで入れれば足りる
process.env.SESSION_SECRET ??= "test-only-secret-0123456789abcdef0123456789";

test("発行したトークンを検証でき、発行時刻を持つ", async () => {
  const before = Date.now();
  const token = await createSessionToken("00000000-0000-0000-0000-000000000001");
  const session = await verifySessionToken(token);
  assert.equal(session?.userId, "00000000-0000-0000-0000-000000000001");
  assert.ok((session?.issuedAt ?? 0) >= before);
});

// 壊れたCookieで例外を投げると、proxyで落ちて全ページが500になっていた
test("壊れた・改ざんされたトークンはnull", async () => {
  assert.equal(await verifySessionToken("a.!!!"), null);
  assert.equal(await verifySessionToken("not-a-token"), null);
  const token = await createSessionToken("00000000-0000-0000-0000-000000000001");
  assert.equal(await verifySessionToken(token.slice(0, -2) + "xx"), null);
});
