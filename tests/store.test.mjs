import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, cleanTags, makeDemoLibrary, LIBRARY_KEY } from "../netlify/lib/store.mjs";

// In-memory mock of the Netlify Blobs store API.
function mockStore() {
  const data = new Map();
  const etags = new Map();
  let counter = 0;
  return {
    async getWithMetadata(key) {
      if (!data.has(key)) return { data: null, etag: null };
      return { data: structuredClone(data.get(key)), etag: etags.get(key) };
    },
    async setJSON(key, value, opts = {}) {
      if (opts.onlyIfNew && data.has(key)) return { modified: false };
      if (opts.onlyIfMatch && etags.get(key) !== opts.onlyIfMatch) return { modified: false };
      data.set(key, structuredClone(value));
      const etag = `"${++counter}"`;
      etags.set(key, etag);
      return { modified: true, etag };
    },
    _raw: data,
  };
}

function sampleItem(overrides = {}) {
  return {
    id: "id-" + Math.random().toString(36).slice(2),
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    canonical_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    platform: "youtube", media_type: "video", external_id: "dQw4w9WgXcQ",
    embed_url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    thumbnail_url: null, title: "Test", author: null,
    tags: [], collection: "", notes: "", favorite: false, watched: false, demo: false,
    metadata_status: "ok", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("cleanTags dedupes and strips #", () => {
  assert.deepEqual(cleanTags("a, #b, A, c"), ["a", "b", "c"]);
  assert.deepEqual(cleanTags(["x", "x", "y"]), ["x", "y"]);
  assert.deepEqual(cleanTags(null), []);
});

test("seeds demo library once", async () => {
  const store = mockStore();
  const repo = makeRepo(store);
  const items = await repo.list();
  assert.equal(items.length, 8);
  assert.ok(items.every((i) => i.demo));
  // second call does not reseed
  const again = await repo.list();
  assert.equal(again.length, 8);
});

test("insert and duplicate detection", async () => {
  const store = mockStore();
  const repo = makeRepo(store);
  await repo.list(); // seed
  const r1 = await repo.insert(sampleItem());
  assert.equal(r1.duplicate, false);
  const r2 = await repo.insert(sampleItem({ id: "other" }));
  assert.equal(r2.duplicate, true);
});

test("insertMany dedupes within batch", async () => {
  const store = mockStore();
  const repo = makeRepo(store);
  await repo.list();
  const a = sampleItem();
  const b = sampleItem({ canonical_url: "https://www.instagram.com/p/abc/", url: "https://www.instagram.com/p/abc/", platform: "instagram" });
  const res = await repo.insertMany([a, b, sampleItem({ id: "dup-of-a" })]);
  assert.equal(res.added.length, 2);
  assert.equal(res.duplicates.length, 1);
});

test("update and remove", async () => {
  const store = mockStore();
  const repo = makeRepo(store);
  await repo.list();
  const { item } = await repo.insert(sampleItem());
  const updated = await repo.update(item.id, { title: "New", favorite: true });
  assert.equal(updated.title, "New");
  assert.equal(updated.favorite, true);
  assert.equal(await repo.remove(item.id), true);
  assert.equal(await repo.remove(item.id), false);
});

test("clearDemo removes only demo items", async () => {
  const store = mockStore();
  const repo = makeRepo(store);
  await repo.list();
  await repo.insert(sampleItem());
  const deleted = await repo.clearDemo();
  assert.equal(deleted, 8);
  const items = await repo.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].demo, false);
});

test("concurrent writes do not lose data", async () => {
  const store = mockStore();
  const repo = makeRepo(store);
  await repo.list();
  // Fire 10 inserts concurrently; ETag retries must keep all of them.
  await Promise.all(Array.from({ length: 10 }, (_, i) =>
    repo.insert(sampleItem({ canonical_url: `https://www.instagram.com/p/item${i}/`, url: `https://www.instagram.com/p/item${i}/`, platform: "instagram" }))
  ));
  const items = await repo.list();
  assert.equal(items.length, 8 + 10);
});

test("demo library shape", () => {
  const lib = makeDemoLibrary();
  assert.equal(lib.version, 1);
  assert.equal(lib.seeded, true);
  assert.equal(lib.items.length, 8);
  assert.ok(lib.items.every((i) => i.id && i.embed_url));
});
