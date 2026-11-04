// oEmbed metadata fetching. Never downloads media files.
const UA = "Mozilla/5.0 (compatible; ReelRoom/1.0; +personal-link-library)";

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal, headers: { "User-Agent": UA } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchMetadata(item) {
  const platform = item.platform;
  const canonical = item.canonical_url;
  let endpoint;
  if (platform === "youtube") {
    endpoint = "https://www.youtube.com/oembed?" + new URLSearchParams({ url: canonical, format: "json" });
  } else if (platform === "tiktok") {
    endpoint = "https://www.tiktok.com/oembed?" + new URLSearchParams({ url: canonical });
  } else if (platform === "instagram" && process.env.META_OEMBED_TOKEN) {
    endpoint = "https://graph.facebook.com/v19.0/instagram_oembed?" + new URLSearchParams({ url: canonical, access_token: process.env.META_OEMBED_TOKEN });
  } else {
    return { metadata_status: "manual" };
  }
  try {
    const data = await fetchJson(endpoint);
    const updates = { metadata_status: "ok" };
    if (data.title) updates.title = String(data.title).slice(0, 300);
    if (data.author_name) updates.author = String(data.author_name).slice(0, 200);
    if (data.thumbnail_url) updates.thumbnail_url = String(data.thumbnail_url).slice(0, 2000);
    return updates;
  } catch {
    return { metadata_status: "error" };
  }
}

// Refresh a batch of pending items. Returns { refreshed, remaining }.
export async function refreshPending(repo, limit = 12) {
  const items = await repo.list();
  const pending = items.filter((i) => i.metadata_status === "pending").slice(0, limit);
  if (pending.length === 0) return { refreshed: 0, remaining: 0 };
  const results = await Promise.all(pending.map(async (item) => {
    const updates = await fetchMetadata(item);
    return [item.id, updates];
  }));
  const updatesById = Object.fromEntries(results);
  await repo.updateMany(updatesById);
  const after = await repo.list();
  const remaining = after.filter((i) => i.metadata_status === "pending").length;
  return { refreshed: pending.length, remaining };
}
