/* ReelRoom frontend */
(() => {
  "use strict";

  const REELROOM_VERSION = "v4";
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const state = {
    items: [],
    view: "all",          // all | favorites | unwatched
    platform: "",
    collection: "",
    tag: "",
    search: "",
    sort: "newest",
    playerIndex: -1,
    editingId: null,
    pollTimer: null,
    fbUseAlt: false,
    useBackup: null,
  };

  const PLATFORM_LABEL = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook" };
  const PLATFORM_ICON = { youtube: "▶", tiktok: "♪", instagram: "◉", facebook: "f" };
  const TYPE_LABEL = { video: "Video", short: "Short", reel: "Reel", image: "Image", post: "Post" };

  // ---------- utils ----------
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function safeUrl(u) {
    try {
      const p = new URL(u);
      return (p.protocol === "http:" || p.protocol === "https:") ? p.href : "";
    } catch { return ""; }
  }
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.startsWith("/api/login") && !path.startsWith("/api/me")) {
      showLogin();
      throw new Error("Please sign in");
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }
  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  // ---------- data ----------
  async function loadItems() {
    try {
      state.items = await api("/api/items");
      render();
      schedulePoll();
    } catch (e) { toast(e.message); }
  }
  function schedulePoll() {
    clearTimeout(state.pollTimer);
    if (state.items.some((i) => i.metadata_status === "pending")) {
      state.pollTimer = setTimeout(refreshPending, 1200);
    }
  }
  async function refreshPending() {
    try {
      const res = await api("/api/refresh-pending", { method: "POST" });
      await loadItems();
      if (res.remaining > 0) state.pollTimer = setTimeout(refreshPending, 800);
    } catch { /* auth modal will handle 401 */ }
  }

  // ---------- auth ----------
  function showLogin() {
    $("#loginModal").hidden = false;
    setTimeout(() => $("#loginPassword").focus(), 50);
  }
  async function checkAuth() {
    try {
      const me = await api("/api/me");
      $("#logoutBtn").hidden = !me.required;
      if (me.required && !me.authenticated) { showLogin(); return false; }
    } catch { /* offline or error; try loading anyway */ }
    return true;
  }
  async function doLogin() {
    const pw = $("#loginPassword").value;
    try {
      await api("/api/login", { method: "POST", body: { password: pw } });
      $("#loginModal").hidden = true;
      $("#loginError").textContent = "";
      $("#loginPassword").value = "";
      $("#logoutBtn").hidden = false;
      await loadItems();
    } catch (e) {
      $("#loginError").innerHTML = `<span class="bad">${esc(e.message)}</span>`;
    }
  }
  async function doLogout() {
    try { await api("/api/logout", { method: "POST" }); } catch {}
    state.items = [];
    render();
    showLogin();
  }

  function filtered() {
    let list = state.items.slice();
    if (state.view === "favorites") list = list.filter((i) => i.favorite);
    if (state.view === "unwatched") list = list.filter((i) => !i.watched);
    if (state.platform) list = list.filter((i) => i.platform === state.platform);
    if (state.collection) list = list.filter((i) => i.collection === state.collection);
    if (state.tag) list = list.filter((i) => (i.tags || []).some((t) => t.toLowerCase() === state.tag.toLowerCase()));
    if (state.search) {
      const q = state.search.toLowerCase();
      list = list.filter((i) =>
        [i.title, i.author, i.collection, i.notes, i.url, ...(i.tags || [])]
          .filter(Boolean).join(" ").toLowerCase().includes(q)
      );
    }
    const stamp = (i) => String(i.created_at || "");
    const sorters = {
      newest: (a, b) => stamp(b).localeCompare(stamp(a)),
      oldest: (a, b) => stamp(a).localeCompare(stamp(b)),
      title: (a, b) => String(a.title || "").localeCompare(String(b.title || "")),
      platform: (a, b) => String(a.platform || "").localeCompare(String(b.platform || "")) || stamp(b).localeCompare(stamp(a)),
    };
    list.sort(sorters[state.sort] || sorters.newest);
    return list;
  }

  // ---------- render ----------
  function render() {
    const list = filtered();
    renderCounts();
    renderCollections();
    renderTags();
    renderChips();
    renderActiveFilters();
    renderGrid(list);
    $("#resultCount").textContent = `${list.length} of ${state.items.length} link${state.items.length === 1 ? "" : "s"}`;
    $("#demoBanner").hidden = !state.items.some((i) => i.demo);
    $("#emptyState").hidden = list.length > 0;
    $("#grid").hidden = list.length === 0;
  }

  function renderCounts() {
    for (const p of Object.keys(PLATFORM_LABEL)) {
      const el = document.querySelector(`[data-count="${p}"]`);
      if (el) el.textContent = state.items.filter((i) => i.platform === p).length || "";
    }
    $$(".side-link[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view && !state.platform && !state.collection && !state.tag));
    $$(".platform-link").forEach((b) => b.classList.toggle("active", b.dataset.platform === state.platform));
  }

  function renderCollections() {
    const cols = [...new Set(state.items.map((i) => i.collection).filter(Boolean))].sort();
    const wrap = $("#collectionList");
    wrap.innerHTML = cols.length
      ? cols.map((c) => `<button class="side-link ${state.collection === c ? "active" : ""}" data-collection="${esc(c)}"><span class="side-ico">📁</span> ${esc(c)}</button>`).join("")
      : `<div class="side-footer" style="margin:0;padding:4px 12px;">No collections yet</div>`;
    wrap.querySelectorAll("[data-collection]").forEach((b) => b.addEventListener("click", () => {
      state.collection = state.collection === b.dataset.collection ? "" : b.dataset.collection;
      render();
    }));
  }

  function renderTags() {
    const tags = [...new Set(state.items.flatMap((i) => i.tags || []))].sort();
    const wrap = $("#tagCloud");
    wrap.innerHTML = tags.length
      ? tags.map((t) => `<button class="tag-pill ${state.tag.toLowerCase() === t.toLowerCase() ? "active" : ""}" data-tag="${esc(t)}">#${esc(t)}</button>`).join("")
      : `<span class="side-footer" style="margin:0;padding:0 4px;">No tags yet</span>`;
    wrap.querySelectorAll("[data-tag]").forEach((b) => b.addEventListener("click", () => {
      state.tag = state.tag === b.dataset.tag ? "" : b.dataset.tag;
      render();
    }));
  }

  function renderChips() {
    $$("#platformChips .chip").forEach((c) => c.classList.toggle("active", c.dataset.platform === state.platform));
  }

  function renderActiveFilters() {
    const parts = [];
    if (state.view !== "all") parts.push({ label: state.view === "favorites" ? "Favorites" : "Unwatched", clear: () => { state.view = "all"; } });
    if (state.collection) parts.push({ label: `Collection: ${state.collection}`, clear: () => { state.collection = ""; } });
    if (state.tag) parts.push({ label: `#${state.tag}`, clear: () => { state.tag = ""; } });
    if (state.search) parts.push({ label: `Search: “${state.search}”`, clear: () => { state.search = ""; $("#searchInput").value = ""; } });
    const wrap = $("#activeFilters");
    wrap.innerHTML = parts.map((p, idx) => `<span class="filter-tag">${esc(p.label)} <button data-idx="${idx}" aria-label="Remove filter">✕</button></span>`).join("");
    wrap.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { parts[+b.dataset.idx].clear(); render(); }));
  }

  // Thumbnail resolution. Some platforms give us one directly; for others we can
  // build a public preview-image URL from the link itself. Nothing is downloaded.
  function thumbnailFor(item) {
    const direct = safeUrl(item.thumbnail_url);
    if (direct) return direct;
    const canonical = safeUrl(item.canonical_url || item.url);
    if (item.platform === "instagram") {
      const m = canonical.match(/instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
      if (m) return `https://www.instagram.com/${m[1]}/${m[2]}/media/?size=l`;
    }
    if (item.platform === "youtube") {
      const id = item.external_id || (canonical.match(/[?&]v=([A-Za-z0-9_-]{6,})/) || [])[1];
      if (id) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    }
    return "";
  }

  function thumbHtml(item) {
    const thumb = thumbnailFor(item);
    const ph = `<div class="thumb-placeholder ph-${item.platform}"><span class="big">${PLATFORM_ICON[item.platform] || "▶"}</span><span>${esc(PLATFORM_LABEL[item.platform] || item.platform)}</span></div>`;
    const img = thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" onerror="this.remove()">` : "";
    return `<div class="thumb">${ph}${img}
      <span class="badge ${item.platform}">${esc(PLATFORM_LABEL[item.platform] || item.platform)}</span>
      ${item.demo ? '<span class="demo-badge">DEMO</span>' : ""}
      <span class="type-badge">${esc(TYPE_LABEL[item.media_type] || item.media_type)}</span>
      <div class="play-overlay"><span>▶</span></div>
    </div>`;
  }

  function renderGrid(list) {
    const grid = $("#grid");
    grid.innerHTML = list.map((item) => `
      <article class="card" data-id="${item.id}" tabindex="0" role="button" aria-label="Play ${esc(item.title)}">
        ${thumbHtml(item)}
        <div class="card-body">
          <h3 class="card-title">${esc(item.title || item.url)}</h3>
          <div class="card-author">${esc(item.author || PLATFORM_LABEL[item.platform] || "")} ${item.watched ? '<span class="watched-mark">✓ watched</span>' : ""}</div>
          <div class="card-meta">
            ${(item.tags || []).slice(0, 3).map((t) => `<span class="mini-tag">#${esc(t)}</span>`).join("")}
            ${item.collection ? `<span class="mini-tag">📁 ${esc(item.collection)}</span>` : ""}
            ${item.backup_embed_url ? `<span class="mini-tag" title="A backup link is set">▶ backup</span>` : ""}
            <span class="card-actions">
              <button data-act="fav" title="Favorite" class="${item.favorite ? "fav-on" : ""}">${item.favorite ? "★" : "☆"}</button>
              <button data-act="edit" title="Edit">✎</button>
              <button data-act="delete" title="Delete">🗑</button>
            </span>
          </div>
        </div>
      </article>`).join("");

    grid.querySelectorAll(".card").forEach((card) => {
      const id = card.dataset.id;
      card.addEventListener("click", (e) => {
        const actBtn = e.target.closest("[data-act]");
        if (actBtn) {
          e.stopPropagation();
          const item = state.items.find((i) => i.id === id);
          if (actBtn.dataset.act === "fav") toggleFav(item);
          if (actBtn.dataset.act === "edit") openEdit(item);
          if (actBtn.dataset.act === "delete") deleteItem(item);
          return;
        }
        openPlayer(id);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPlayer(id); }
      });
    });
  }

  // ---------- player ----------
  function currentList() { return filtered(); }

  function openPlayer(id) {
    const list = currentList();
    const idx = list.findIndex((i) => i.id === id);
    if (idx === -1) return;
    state.playerIndex = idx;
    state.fbUseAlt = false;
    state.useBackup = null;
    renderPlayer(list[idx]);
    $("#playerModal").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function facebookEmbeds(item) {
    const canonical = safeUrl(item.canonical_url || item.url);
    if (!canonical) return { primary: safeUrl(item.embed_url), alt: "" };
    const post = "https://www.facebook.com/plugins/post.php?" + new URLSearchParams({ href: canonical, show_text: "true" });
    const video = "https://www.facebook.com/plugins/video.php?" + new URLSearchParams({ href: canonical, show_text: "false", autoplay: "true", mute: "0" });
    // Verified: Facebook's post.php plugin returns an error page for /reel/ links,
    // so Reels must use the video player. Only plain video/post links get a fallback.
    if (item.media_type === "reel") return { primary: video, alt: "" };
    if (item.media_type === "video") return { primary: video, alt: post };
    return { primary: safeUrl(item.embed_url) || post, alt: "" };
  }

  function stampVersion() {
    const footer = document.querySelector(".side-footer");
    if (footer) footer.textContent = "Embed-only \u00b7 nothing is downloaded \u00b7 " + REELROOM_VERSION;
    const top = document.querySelector(".topbar");
    if (top && !$("#versionBadge")) {
      const badge = document.createElement("span");
      badge.id = "versionBadge";
      badge.textContent = REELROOM_VERSION;
      badge.title = "ReelRoom build version";
      badge.style.cssText = "font-size:11px;color:#9a9a9a;border:1px solid #3a3a3a;border-radius:6px;padding:2px 6px;flex-shrink:0;";
      top.appendChild(badge);
    }
    try { console.log("ReelRoom " + REELROOM_VERSION + " (backup links)"); } catch {}
  }

  function ensurePlayerActionButtons() {
    const actions = document.querySelector(".player-actions");
    if (!actions) return;
    const fav = $("#favBtn");
    const oldToggle = $("#fbEmbedToggleBtn");
    if (oldToggle) oldToggle.hidden = true;

    let postBtn = $("#fbPostPlayerBtn");
    if (!postBtn) {
      postBtn = document.createElement("button");
      postBtn.id = "fbPostPlayerBtn";
      postBtn.type = "button";
      postBtn.className = "btn btn-small";
      actions.insertBefore(postBtn, fav || null);
    }
    let videoBtn = $("#fbVideoPlayerBtn");
    if (!videoBtn) {
      videoBtn = document.createElement("button");
      videoBtn.id = "fbVideoPlayerBtn";
      videoBtn.type = "button";
      videoBtn.className = "btn btn-small";
      actions.insertBefore(videoBtn, fav || null);
    }
    let copyBtn = $("#copyLinkBtn");
    if (!copyBtn) {
      copyBtn = document.createElement("button");
      copyBtn.id = "copyLinkBtn";
      copyBtn.type = "button";
      copyBtn.className = "btn btn-small";
      copyBtn.textContent = "Copy link";
      actions.insertBefore(copyBtn, fav || null);
    }
    for (const [id, text] of [["sourceOriginalBtn", "Original"], ["sourceBackupBtn", "Backup"], ["addBackupBtn", "Add backup link"]]) {
      let btn = $("#" + id);
      if (!btn) {
        btn = document.createElement("button");
        btn.id = id;
        btn.type = "button";
        btn.className = "btn btn-small";
        btn.textContent = text;
        actions.insertBefore(btn, fav || null);
      }
      btn.hidden = true;
    }
  }

  function ensureBackupField() {
    if ($("#editBackupUrl")) return;
    const modal = $("#editModal");
    if (!modal) return;
    const actionsRow = modal.querySelector(".modal-actions");
    const label = document.createElement("label");
    label.innerHTML = 'Backup link (optional)' +
      '<input type="url" id="editBackupUrl" placeholder="Paste the same clip on YouTube / TikTok / Instagram">' +
      '<span style="display:block;font-size:12px;color:#9a9a9a;margin-top:4px;">If the original site blocks embedding, ReelRoom plays this link instead.</span>';
    if (actionsRow) actionsRow.parentNode.insertBefore(label, actionsRow);
    else modal.appendChild(label);
  }

  function activeSources(item) {
    let originalEmbed = safeUrl(item.embed_url);
    if (item.platform === "facebook") {
      const { primary, alt } = facebookEmbeds(item);
      originalEmbed = state.fbUseAlt && alt ? alt : primary;
    }
    const sources = [{
      key: "original",
      label: PLATFORM_LABEL[item.platform] || "Original",
      embed: originalEmbed,
      platform: item.platform,
      media_type: item.media_type,
      url: safeUrl(item.canonical_url || item.url),
    }];
    const backupEmbed = safeUrl(item.backup_embed_url);
    if (backupEmbed) {
      sources.push({
        key: "backup",
        label: PLATFORM_LABEL[item.backup_platform] || "Backup",
        embed: backupEmbed,
        platform: item.backup_platform,
        media_type: item.backup_media_type,
        url: safeUrl(item.backup_canonical_url || item.backup_url),
      });
    }
    return sources;
  }

  function stageClass(src, embed) {
    if (src.platform === "facebook") {
      if (embed.includes("/plugins/post.php")) return "stage-post";
      if (src.media_type === "reel") return "stage-vertical";
      return "stage-video";
    }
    if (["tiktok", "instagram"].includes(src.platform) && ["reel", "short", "video"].includes(src.media_type)) return "stage-vertical";
    if (src.platform === "youtube" && src.media_type === "short") return "stage-vertical";
    if (src.platform === "instagram" && ["post", "image"].includes(src.media_type)) return "stage-post";
    return "stage-video";
  }

  function setFacebookPlayer(mode) {
    const item = currentList()[state.playerIndex];
    if (!item || item.platform !== "facebook") return;
    const { primary } = facebookEmbeds(item);
    const primaryIsPost = primary.includes("/plugins/post.php");
    state.fbUseAlt = mode === "post" ? !primaryIsPost : primaryIsPost;
    renderPlayer(item);
  }

  function renderPlayer(item) {
    $("#playerTitle").textContent = item.title || item.url;
    $("#playerSub").textContent = [item.author, PLATFORM_LABEL[item.platform], TYPE_LABEL[item.media_type], item.collection].filter(Boolean).join(" · ");
    $("#openOriginalBtn").href = safeUrl(item.canonical_url || item.url);
    $("#favBtn").textContent = item.favorite ? "★ Favorited" : "☆ Favorite";
    $("#watchedBtn").textContent = item.watched ? "✓ Watched" : "Mark watched";

    const stage = $("#playerStage");
    ensurePlayerActionButtons();

    const sources = activeSources(item);
    const hasBackup = sources.length > 1;
    const useBackup = hasBackup && state.useBackup !== false;
    const active = useBackup ? sources[1] : sources[0];
    const embed = active.embed;

    const origBtn = $("#sourceOriginalBtn");
    const backBtn = $("#sourceBackupBtn");
    const addBackupBtn = $("#addBackupBtn");
    if (origBtn && backBtn) {
      origBtn.hidden = !hasBackup;
      backBtn.hidden = !hasBackup;
      if (hasBackup) {
        origBtn.textContent = (useBackup ? "" : "✓ ") + "Original · " + sources[0].label;
        backBtn.textContent = (useBackup ? "✓ " : "") + "Backup · " + sources[1].label;
        origBtn.disabled = !useBackup;
        backBtn.disabled = useBackup;
      }
    }
    if (addBackupBtn) {
      addBackupBtn.hidden = false;
      addBackupBtn.textContent = hasBackup ? "Change backup link" : "Add backup link";
    }
    $("#openOriginalBtn").href = active.url || safeUrl(item.canonical_url || item.url);

    const fbPostBtn = $("#fbPostPlayerBtn");
    const fbVideoBtn = $("#fbVideoPlayerBtn");
    if (fbPostBtn) fbPostBtn.hidden = true;
    if (fbVideoBtn) fbVideoBtn.hidden = true;
    if (!useBackup && item.platform === "facebook") {
      const { alt } = facebookEmbeds(item);
      if (alt && fbPostBtn && fbVideoBtn) {
        const usingPost = embed.includes("/plugins/post.php");
        fbPostBtn.hidden = false;
        fbVideoBtn.hidden = false;
        fbPostBtn.textContent = usingPost ? "Post player ✓" : "Try post player";
        fbVideoBtn.textContent = usingPost ? "Try video player" : "Video player ✓";
        fbPostBtn.disabled = usingPost;
        fbVideoBtn.disabled = !usingPost;
      }
    }

    const cls = stageClass(active, embed);
    stage.innerHTML = embed
      ? `<div class="${cls}"><iframe src="${esc(embed)}" title="${esc(item.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`
      : `<div style="padding:40px;color:#aaa;">No embed available. Use “Open original”.</div>`;

    const note = document.querySelector(".embed-note");
    if (note) {
      if (useBackup) {
        note.textContent = "Playing your backup link (" + sources[1].label + "). Switch to “Original” to see the source post.";
      } else if (item.platform === "facebook") {
        note.textContent = "If Facebook says “content owned by someone else”, Facebook is refusing to let this video play on other websites. Add a backup link to the same clip on YouTube, TikTok or Instagram and ReelRoom will play that here instead.";
      } else {
        note.textContent = "Playback blocked? Use “Open original”, or add a backup link to the same clip on another site.";
      }
    }

    const list = currentList();
    $("#prevBtn").disabled = state.playerIndex <= 0;
    $("#nextBtn").disabled = state.playerIndex >= list.length - 1;
  }

  function closePlayer() {
    $("#playerModal").hidden = true;
    $("#playerStage").innerHTML = "";
    document.body.style.overflow = "";
    state.playerIndex = -1;
  }

  function stepPlayer(delta) {
    const list = currentList();
    const next = state.playerIndex + delta;
    if (next < 0 || next >= list.length) return;
    state.playerIndex = next;
    state.fbUseAlt = false;
    state.useBackup = null;
    renderPlayer(list[next]);
  }

  async function copyCurrentLink() {
    const item = currentList()[state.playerIndex];
    const url = item?.canonical_url || item?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      prompt("Copy this link:", url);
    }
  }

  async function toggleFav(item) {
    try {
      const updated = await api(`/api/items/${item.id}`, { method: "PATCH", body: { favorite: !item.favorite } });
      Object.assign(item, updated);
      render();
      if (!$("#playerModal").hidden && state.playerIndex >= 0) renderPlayer(currentList()[state.playerIndex]);
    } catch (e) { toast(e.message); }
  }

  async function toggleWatched(item) {
    try {
      const updated = await api(`/api/items/${item.id}`, { method: "PATCH", body: { watched: !item.watched } });
      Object.assign(item, updated);
      render();
      if (!$("#playerModal").hidden && state.playerIndex >= 0) renderPlayer(currentList()[state.playerIndex]);
    } catch (e) { toast(e.message); }
  }

  async function deleteItem(item) {
    if (!confirm(`Delete “${item.title || item.url}” from your library?`)) return;
    try {
      await api(`/api/items/${item.id}`, { method: "DELETE" });
      state.items = state.items.filter((i) => i.id !== item.id);
      closePlayer();
      render();
      toast("Deleted");
    } catch (e) { toast(e.message); }
  }

  // ---------- add ----------
  function detectPlatform(url) {
    const u = url.toLowerCase();
    if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
    if (u.includes("tiktok.com")) return "tiktok";
    if (u.includes("instagram.com")) return "instagram";
    if (u.includes("facebook.com") || u.includes("fb.watch")) return "facebook";
    return null;
  }

  async function addSingle() {
    const url = $("#singleUrl").value.trim();
    if (!url) { toast("Paste a link first"); return; }
    try {
      const data = await api("/api/items", {
        method: "POST",
        body: {
          url,
          title: $("#singleTitle").value.trim() || undefined,
          collection: $("#singleCollection").value.trim() || undefined,
          tags: $("#singleTags").value.trim() || undefined,
          notes: $("#singleNotes").value.trim() || undefined,
        },
      });
      if (data.duplicate) {
        toast("Already in your library");
      } else {
        state.items.unshift(data.item);
        toast("Added to library");
      }
      $("#singleUrl").value = ""; $("#singleTitle").value = ""; $("#singleTags").value = ""; $("#singleNotes").value = "";
      $("#detectedPlatform").textContent = "";
      render();
      schedulePoll();
    } catch (e) { toast(e.message); }
  }

  async function addBulk() {
    const text = $("#bulkUrls").value.trim();
    if (!text) { toast("Paste at least one link"); return; }
    const btn = $("#bulkAddBtn");
    btn.disabled = true; btn.textContent = "Adding…";
    try {
      const data = await api("/api/items/bulk", {
        method: "POST",
        body: { urls: text, collection: $("#bulkCollection").value.trim() || undefined, tags: $("#bulkTags").value.trim() || undefined },
      });
      const lines = [`Added: ${data.added.length}`, `Duplicates skipped: ${data.duplicates.length}`];
      if (data.errors.length) lines.push(`Errors: ${data.errors.length}`, ...data.errors.slice(0, 8).map((e) => `• ${e.url} — ${e.error}`));
      $("#bulkResult").textContent = lines.join("\n");
      toast(`Added ${data.added.length} link${data.added.length === 1 ? "" : "s"}`);
      $("#bulkUrls").value = "";
      await loadItems();
    } catch (e) { toast(e.message); }
    finally { btn.disabled = false; btn.textContent = "Add all links"; }
  }

  // ---------- edit ----------
  function openEdit(item) {
    state.editingId = item.id;
    $("#editTitle").value = item.title || "";
    $("#editAuthor").value = item.author || "";
    $("#editCollection").value = item.collection || "";
    $("#editTags").value = (item.tags || []).join(", ");
    $("#editThumb").value = item.thumbnail_url || "";
    $("#editNotes").value = item.notes || "";
    $("#editType").value = item.media_type || "video";
    $("#editFavorite").checked = !!item.favorite;
    ensureBackupField();
    $("#editBackupUrl").value = item.backup_url || "";
    $("#editModal").hidden = false;
  }

  async function saveEdit() {
    if (!state.editingId) return;
    try {
      const updated = await api(`/api/items/${state.editingId}`, {
        method: "PATCH",
        body: {
          title: $("#editTitle").value.trim(),
          author: $("#editAuthor").value.trim(),
          collection: $("#editCollection").value.trim(),
          tags: $("#editTags").value,
          thumbnail_url: $("#editThumb").value.trim() || null,
          notes: $("#editNotes").value.trim(),
          media_type: $("#editType").value,
          favorite: $("#editFavorite").checked,
          backup_url: $("#editBackupUrl") ? $("#editBackupUrl").value.trim() : "",
        },
      });
      const idx = state.items.findIndex((i) => i.id === updated.id);
      if (idx >= 0) state.items[idx] = updated;
      $("#editModal").hidden = true;
      render();
      if (!$("#playerModal").hidden && state.playerIndex >= 0) renderPlayer(currentList()[state.playerIndex]);
      toast("Saved");
    } catch (e) { toast(e.message); }
  }

  async function refreshMeta() {
    if (!state.editingId) return;
    try {
      const updated = await api(`/api/items/${state.editingId}/refresh`, { method: "POST" });
      const idx = state.items.findIndex((i) => i.id === updated.id);
      if (idx >= 0) state.items[idx] = updated;
      $("#editTitle").value = updated.title || "";
      $("#editAuthor").value = updated.author || "";
      $("#editThumb").value = updated.thumbnail_url || "";
      render();
      toast(updated.metadata_status === "ok" ? "Metadata refreshed" : "Metadata unavailable — you can edit it manually");
    } catch (e) { toast(e.message); }
  }

  // ---------- import/export/demo ----------
  async function clearDemo() {
    if (!confirm("Remove all demo items? Your own links will stay.")) return;
    try {
      const data = await api("/api/demo", { method: "DELETE" });
      state.items = state.items.filter((i) => !i.demo);
      render();
      toast(`Removed ${data.deleted} demo item${data.deleted === 1 ? "" : "s"}`);
    } catch (e) { toast(e.message); }
  }

  async function importFile(file) {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const data = await api("/api/import", { method: "POST", body: json });
      toast(`Imported ${data.added} link${data.added === 1 ? "" : "s"} (${data.duplicates} duplicates skipped)`);
      await loadItems();
    } catch (e) { toast("Import failed: " + e.message); }
  }

  // ---------- events ----------
  function bind() {
    $("#addBtn").addEventListener("click", () => { $("#addModal").hidden = false; $("#singleUrl").focus(); });
    $("#emptyAddBtn").addEventListener("click", () => { $("#addModal").hidden = false; $("#singleUrl").focus(); });
    $$("[data-close]").forEach((b) => b.addEventListener("click", () => { $("#" + b.dataset.close).hidden = true; }));
    $$(".modal-backdrop").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) { m.hidden = true; if (m.id === "playerModal") closePlayer(); } }));

    $("#menuBtn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    $("#brandLink").addEventListener("click", (e) => { e.preventDefault(); state.view = "all"; state.platform = ""; state.collection = ""; state.tag = ""; state.search = ""; $("#searchInput").value = ""; render(); });

    $("#searchInput").addEventListener("input", debounce((e) => { state.search = e.target.value.trim(); render(); }, 180));
    $("#sortSelect").addEventListener("change", (e) => { state.sort = e.target.value; render(); });

    $$(".side-link[data-view]").forEach((b) => b.addEventListener("click", () => { state.view = b.dataset.view; state.platform = ""; state.collection = ""; state.tag = ""; render(); $("#sidebar").classList.remove("open"); }));
    $$(".platform-link").forEach((b) => b.addEventListener("click", () => { state.platform = state.platform === b.dataset.platform ? "" : b.dataset.platform; state.view = "all"; render(); $("#sidebar").classList.remove("open"); }));
    $$("#platformChips .chip").forEach((c) => c.addEventListener("click", () => { state.platform = c.dataset.platform; render(); }));

    $("#moreBtn").addEventListener("click", (e) => { e.stopPropagation(); $("#moreMenu").hidden = !$("#moreMenu").hidden; });
    document.addEventListener("click", () => { $("#moreMenu").hidden = true; });
    $("#moreMenu").addEventListener("click", (e) => {
      const act = e.target.dataset.action;
      if (act === "export") window.location.href = "/api/export";
      if (act === "import") $("#importFile").click();
      if (act === "clear-demo") clearDemo();
      if (act === "logout") doLogout();
    });
    $("#clearDemoBtn").addEventListener("click", clearDemo);
    $("#importFile").addEventListener("change", (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ""; });

    $$(".tab").forEach((t) => t.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
      $("#tab-single").hidden = t.dataset.tab !== "single";
      $("#tab-bulk").hidden = t.dataset.tab !== "bulk";
    }));
    $("#singleUrl").addEventListener("input", (e) => {
      const p = detectPlatform(e.target.value.trim());
      $("#detectedPlatform").innerHTML = e.target.value.trim()
        ? (p ? `<span class="ok">Detected: ${PLATFORM_LABEL[p]}</span>` : `<span class="bad">Unsupported platform</span>`)
        : "";
    });
    $("#singleAddBtn").addEventListener("click", addSingle);
    $("#bulkAddBtn").addEventListener("click", addBulk);

    stampVersion();
    ensurePlayerActionButtons();
    $("#closePlayerBtn").addEventListener("click", closePlayer);
    $("#prevBtn").addEventListener("click", () => stepPlayer(-1));
    $("#nextBtn").addEventListener("click", () => stepPlayer(1));
    const playerActions = document.querySelector(".player-actions");
    if (playerActions) {
      playerActions.addEventListener("click", (e) => {
        const id = e.target && e.target.id;
        if (id === "fbPostPlayerBtn") setFacebookPlayer("post");
        if (id === "fbVideoPlayerBtn") setFacebookPlayer("video");
        if (id === "sourceOriginalBtn" || id === "sourceBackupBtn") {
          state.useBackup = id === "sourceBackupBtn";
          const it = currentList()[state.playerIndex];
          if (it) renderPlayer(it);
        }
        if (id === "addBackupBtn") {
          const it = currentList()[state.playerIndex];
          if (it) {
            openEdit(it);
            const f = $("#editBackupUrl");
            if (f) f.focus();
          }
        }
      });
    }
    $("#copyLinkBtn").addEventListener("click", copyCurrentLink);
    $("#favBtn").addEventListener("click", () => { const it = currentList()[state.playerIndex]; if (it) toggleFav(it); });
    $("#watchedBtn").addEventListener("click", () => { const it = currentList()[state.playerIndex]; if (it) toggleWatched(it); });
    $("#editBtn").addEventListener("click", () => { const it = currentList()[state.playerIndex]; if (it) openEdit(it); });
    $("#deleteBtn").addEventListener("click", () => { const it = currentList()[state.playerIndex]; if (it) deleteItem(it); });

    $("#loginBtn").addEventListener("click", doLogin);
    $("#loginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });

    $("#saveEditBtn").addEventListener("click", saveEdit);
    $("#refreshMetaBtn").addEventListener("click", refreshMeta);

    document.addEventListener("keydown", (e) => {
      const tag = document.activeElement && document.activeElement.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Escape") {
        if (!$("#editModal").hidden) $("#editModal").hidden = true;
        else if (!$("#addModal").hidden) $("#addModal").hidden = true;
        else if (!$("#playerModal").hidden) closePlayer();
      }
      if (!typing && e.key === "/") { e.preventDefault(); $("#searchInput").focus(); }
      if (!$("#playerModal").hidden && !typing) {
        if (e.key === "ArrowLeft") stepPlayer(-1);
        if (e.key === "ArrowRight") stepPlayer(1);
      }
    });
  }

  bind();
  checkAuth().then((ok) => { if (ok) loadItems(); });
})();
