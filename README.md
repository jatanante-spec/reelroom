# ReelRoom — Netlify edition

Your personal, embed-only video wall, rebuilt to run **natively on Netlify**:

- **Static frontend** in `public/` (the YouTube-style grid + player)
- **One Netlify Function** (`netlify/functions/api.mjs`) handling all `/api/*` routes
- **Netlify Blobs** for storage — no external database, no connection strings, survives redeploys
- Optional **password gate** via a single environment variable

Videos are never downloaded; they stream from the original platform via official embeds.

> This is the Netlify-native version. The earlier Flask/SQLite version is in `../reelroom/` and is
> meant for hosts that run a long-lived Python server (Render, Railway, a VPS). On Netlify, use **this** folder.

---

## Deploy to Netlify

### Option A — Git (recommended)

1. Push this `reelroom-netlify` folder to a GitHub/GitLab repo (it can be the repo root).
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
3. Netlify auto-detects `netlify.toml`. Confirm:
   - **Build command:** `npm run build`
   - **Publish directory:** `public`
   - **Functions directory:** `netlify/functions`
4. (Optional but recommended) **Site configuration → Environment variables** → add:
   - `REELROOM_PASSWORD` = a password you choose (locks the library behind a sign-in)
5. **Deploy**. You'll get an HTTPS URL that works from any device.

### Option B — Netlify CLI

```bash
cd reelroom-netlify
npm install
npx netlify login          # opens browser to authorize
npx netlify init           # create/link a site
npx netlify deploy --build --prod
```

Set `REELROOM_PASSWORD` in the Netlify dashboard (or `npx netlify env:set REELROOM_PASSWORD "your-password"`).

### Local development

```bash
npm install
npm run dev                # netlify dev, uses a local Blobs sandbox
# open http://localhost:8888
```

`netlify dev` emulates Functions + Blobs locally, so you can test before deploying.
(Local sandbox data is separate from production data.)

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `REELROOM_PASSWORD` | Recommended | Require a password to view/edit the library. Leave unset for open access. |
| `META_OEMBED_TOKEN` | Optional | Meta oEmbed token to auto-fetch Instagram titles/thumbnails. |
| `NO_SEED` | Optional | Set to `1` to skip the demo collection on first run. |

Set these in **Site configuration → Environment variables** (they're available to Functions at runtime).

---

## How it works on Netlify

| Piece | Netlify feature |
|---|---|
| Grid / player UI | Static files on the CDN (`public/`) |
| Add / edit / search API | Netlify Function at `/api/*` |
| Library storage | Netlify Blobs (one JSON document, strong consistency) |
| Sign-in | HttpOnly cookie checked by the Function |

The whole library is stored as a single JSON blob. Writes use ETag-based optimistic concurrency in
production, so simultaneous edits don't clobber each other. That's plenty fast for a personal
library of hundreds of links.

## Features

- YouTube-style responsive thumbnail grid, dark theme
- Single-link add + bulk paste (up to 500 per batch)
- Auto-detects YouTube / TikTok / Instagram / Facebook and builds the right embed
- Auto-fetches title/creator/thumbnail via oEmbed (YouTube, TikTok; Instagram with a Meta token)
- Search, platform/collection/tag filters, favorites, watched/unwatched, sorting
- In-page player with prev/next + keyboard shortcuts, "Open original" fallback
- Collections, tags, notes, manual metadata editing
- JSON export/import for backup
- Demo collection you can clear with one click
- Optional password sign-in

## Embed limits (same as any embed-only library)

- **YouTube**: very reliable.
- **TikTok**: reliable, includes photo posts and short-link resolution.
- **Instagram / Facebook**: some posts require login or block embedding. Every item has an
  **Open original** fallback. Nothing is downloaded, so private/deleted/region-locked posts
  can't be forced to play.

## Tests

```bash
npm test    # 22 tests: URL parsing, storage/concurrency, auth
```

## Project layout

```
reelroom-netlify/
├── netlify.toml              # Netlify build + functions config
├── package.json
├── public/                   # static frontend (index.html, styles.css, app.js)
├── netlify/
│   ├── functions/api.mjs     # all /api/* routes
│   └── lib/                  # parse, store (Blobs), metadata, auth
├── scripts/build.mjs         # build validation
└── tests/                    # node:test suites
```
