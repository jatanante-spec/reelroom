import { test } from "node:test";
import assert from "node:assert/strict";

async function loadAuth() {
  // Re-import with a fresh module cache so env changes take effect.
  const mod = await import("../netlify/lib/auth.mjs?x=" + Math.random());
  return mod;
}

test("no password set -> open access", async () => {
  delete process.env.REELROOM_PASSWORD;
  const auth = await loadAuth();
  assert.equal(auth.passwordRequired(), false);
  assert.equal(auth.isAuthenticated(new Request("http://localhost/api/items")), true);
});

test("password set -> cookie required", async () => {
  process.env.REELROOM_PASSWORD = "secret123";
  const auth = await loadAuth();
  assert.equal(auth.passwordRequired(), true);
  assert.equal(auth.checkPassword("secret123"), true);
  assert.equal(auth.checkPassword("wrong"), false);
  const req = new Request("http://localhost/api/items");
  assert.equal(auth.isAuthenticated(req), false);
  const cookie = auth.makeCookie("secret123", false);
  const req2 = new Request("http://localhost/api/items", { headers: { cookie } });
  assert.equal(auth.isAuthenticated(req2), true);
  delete process.env.REELROOM_PASSWORD;
});
