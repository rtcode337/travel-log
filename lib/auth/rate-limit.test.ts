import { test } from "node:test";
import assert from "node:assert/strict";
import { getClientIp, isRateLimited, recordFailure } from "@/lib/auth/rate-limit";

const req = (headers: Record<string, string>) => new Request("http://localhost/", { headers });

// 先頭はクライアントが書けるので、プロキシが足した末尾を使う
test("X-Forwarded-For の末尾を接続元とする", () => {
  assert.equal(getClientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.5" })), "10.0.0.5");
  assert.equal(getClientIp(req({})), "unknown");
});

test("上限に達するまでは通し、達したら止める", () => {
  const key = "test:limit@example.com";
  for (let i = 0; i < 4; i++) recordFailure(key);
  assert.equal(isRateLimited(key, 5), false);
  recordFailure(key);
  assert.equal(isRateLimited(key, 5), true);
});
