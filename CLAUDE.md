# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small PHP 7.0 API + Webix.js front end that browses a directory of images which is intentionally **not** web-accessible (not served directly by nginx/apache). All access goes through this app, which reads the directory once, caches the file list to disk, and serves images and metadata through a JSON API.

## Setup

Edit `config.php` — in particular `image_dir`, which must point to the absolute path of the directory containing images. It currently holds a placeholder (`/var/data/images`).

The project is a **flat layout by design**: `index.php` lives at the project root, not under a `public/` subfolder. This means the whole folder *is* the document root — drop it anywhere the web server serves from (including as a subdirectory of a shared docroot) with no per-deployment webroot config. That flatness exists specifically to support running many independent copies side by side, one per image directory (e.g. `/var/www/html/custa` with `image_dir = /img/custa`, `/var/www/html/custb` with `image_dir = /img/custb`), each just a full copy of this project with its own `config.php`.

Because the docroot is the project root, `config.php`, `src/`, `cache/`, and `bin/` sit alongside the public entry point and must stay blocked from direct web access — see `.htaccess` (Apache, `mod_rewrite`), which both denies those paths and routes all other non-file requests to `index.php`. For nginx, replicate both the deny rule and the fallback route:

```
location ~ ^/(config\.php|src/|cache/|bin/) {
    deny all;
    return 403;
}

location / {
    try_files $uri $uri/ /index.php?$query_string;
}
```

There is no build step, package manager, or test suite — it's plain PHP 7.0 (no Composer) and a static front end loading Webix and Lodash from CDNs.

## Commands

- Rebuild the file-list cache after adding/removing images on disk: `php bin/rebuild-cache.php`
- Local dev server: `php -S 0.0.0.0:8080 router.php` (or run the equivalent inside a `php:7.0-cli` Docker container if PHP isn't installed locally — this repo was developed/verified that way). `router.php` is dev-server-only glue — see the routing note below for why it's needed and Apache/nginx don't need it.

There's no automated test suite; verify changes by hitting the endpoints directly (`curl`) and loading `index.html` in a browser.

## Architecture

**Caching is the core design constraint.** The image directory is assumed not to change often, so `src/Scanner.php` performs a **non-recursive, top-level-only** filesystem scan, and `src/Cache.php` persists the result to `cache/images.json` along with a `signature` (md5 of every file's sorted `name:size:mtime`) and `generated_at`. Every request reads the JSON cache; there's no per-item filesystem access. You can still force an immediate rebuild by deleting `cache/images.json` or running `bin/rebuild-cache.php`, but it also self-heals: once a cache entry is older than `config.php`'s `cache_ttl` (default 24h, matching the accepted staleness window), the next request triggers one cheap stat-only re-scan (no `getimagesize`, no file reads) and compares its signature against the stored one — a real change (add/remove/replace) triggers a full rebuild, otherwise only `generated_at` is bumped so the next check waits another full TTL. This logic lives in `Cache::currentPayload()`, the single place both `items()` and `stats()` go through — `stats()` used to read the raw payload directly without this check, which meant it could report stale counts even after `items()`/`all()` had already detected a change; if you add another cache-reading method, route it through `currentPayload()` too instead of `readPayload()` directly.

**ID scheme:** each image's `id` is `substr(md5($filename), 0, 12)` — a hash of the filename, not a scan-order index. This keeps ids stable across cache rebuilds even if files are added or removed, and matches the route pattern `[a-f0-9]{12}` used by the router.

**Request flow:** `index.php` (project root) is the single front controller. Rather than computing a base path via `SCRIPT_NAME`/`dirname` and stripping it, it just finds the literal `/api/` marker in `REQUEST_URI` and treats everything from there on as the route — this is deliberately robust across Apache, nginx, and PHP's built-in dev server, since `SCRIPT_NAME` behaves inconsistently between them (notably, it reflects the *request* path rather than the executing script's path when the built-in server is run with a router script, which broke the old approach). Given that:
- Any path without `/api/` in it serves `index.html` (the Webix SPA shell) directly.
- Everything from `/api/` onward is matched by hand-rolled regex against `App\Controllers\ImagesController` methods — there is no router class or framework.

`router.php` exists only so `php -S` can be used for local dev at all: without a router script, PHP's built-in server 404s any request whose last path segment looks like a filename (has a dot) before your PHP code ever runs — a real problem given `GET /api/images/file/{filename}` below. Apache/nginx never hit this since `.htaccess`/`try_files` handle the fallback routing themselves.

Class autoloading is a minimal `spl_autoload_register` in `src/autoload.php` mapping the `App\` namespace to `src/` (no Composer).

**Endpoints** (`src/Controllers/ImagesController.php`):
- `GET /api/images?page=&limit=` — paged listing, sourced from the cache, sorted by name. Still here for compatibility, but the front end no longer uses it for its initial load (see below).
- `GET /api/images/all` — the entire listing in one response (same per-item shape as above, plus `count`/`total_size`/`total_size_human`/`generated_at`). This is what the front end fetches once at load time instead of paginating through hundreds of requests at 30k+ files; it relies on the gzip compression described below to keep the transfer size reasonable.
- `GET /api/images/stats` — just `count`/`total_size`/`total_size_human`/`generated_at`, no items. Cheap and fast, so the front end fetches this first to populate the loading screen before starting the much larger `/all` request.
- `GET /api/images/{id}` — metadata: size, human size, mime, width/height (via `getimagesize`), created/modified. Note `created` uses `ctime` (inode change time) since PHP has no portable file-birth-time API on Linux — it's a best-effort proxy, not a true creation date.
- `GET /api/images/{id}/raw` — streams the actual file bytes with ETag/Last-Modified/304 support and `Content-Disposition: inline`. This is the only endpoint that touches the real file path from `image_dir` for the gallery; everything else works off cached metadata.
- `GET /api/images/file/{filename}` — same metadata as `/{id}`, plus the file's contents inline as `base64`. Looked up by exact filename match against the cache (`Cache::findByName`), not by id. Loads the whole file into memory to encode it, so it's meant for occasional direct lookups, not bulk use.

`index.php` wraps its output in `ob_start('ob_gzhandler')` when zlib is available and the web server isn't already compressing (`zlib.output_compression` off), specifically so `/api/images/all` doesn't ship tens of MB uncompressed at scale. This is deliberately skipped for `/{id}/raw`: that endpoint sends an exact `Content-Length` for the streamed file bytes, and gzipping under it would desync the declared length from what's actually transmitted and corrupt the download. The check is done via a regex against `$uri` before routing, not per-controller-method, so if you add a new binary-streaming endpoint, exclude it the same way.

`src/Cache.php`'s cache-writing path throws a `RuntimeException` (surfaced as a 500 with a clear message by `index.php`'s catch block) if the cache file can't be written — e.g. wrong permissions on `cache/`. It used to fail silently, leaving `cache/` empty with no indication why; if you see that behavior again, check write permissions before assuming it's a code bug. Cache files written before the `signature` field existed are treated as absent (triggering a full rebuild) rather than causing an error — `Cache::readPayload()` requires `signature` to be present, not just `items`.

**Front end** (`app.js`): a single Webix `dataview` gallery bound to a `pager`, both manually wired (not using Webix's auto-master pager binding). Several non-obvious gotchas if touching this file:
- The `pager` view must have `master: false`, otherwise Webix recomputes page count from the dataview's *currently loaded* record count instead of the server-reported total, which silently caps pagination at 1 page.
- The `onAfterPageChange` handler receives `page` as a **string**. `page + 1` does string concatenation (e.g. `"2" + 1 -> "21"`), not numeric addition — always `parseInt(page, 10) + 1`. The pager's built-in `getPage()` method also doesn't exist despite being a natural guess — use the event argument or `config.page`.
- The `toolbar` and `pager` rows must have an explicit `height`. Without it, with enough images the dataview's natural content height can push the pager out of the layout's calculated space entirely (not just off-screen — genuinely unreachable, no scrollbar). Giving the fixed-height rows an explicit height lets the layout correctly hand the dataview the remaining space as a scrollable region (`scroll: "y"`), keeping the pager permanently visible regardless of item count.
- API/image URLs are built from a `basePath` derived from `app.js`'s own `<script src>` (via `document.querySelector('script[src*="app.js"]')`), not `window.location`. This is what makes a single unmodified `app.js` work correctly under the multi-tenant subdirectory deployments described in Setup — using absolute root paths like `/api/images` previously caused every subdirectory deployment to silently hit the root instance's API instead of its own.

Detail view is a Webix `window` (not `modalbox` — modalbox's positioning has a bug where it can render partially off-screen with taller content, and lacks the layout control needed here) with `gravity: 4` / `gravity: 1` rows for an 80/20 image/metadata split, and a CSS `columns` layout (`.detail-window-meta`) that auto-flows the metadata into 2–3 columns depending on width. Two gotchas specific to this window:
- Webix `window` views don't accept percentage strings for `width`/`height` (unlike `modalbox`) — they throw "Size is not a number". Compute pixel values from `window.innerWidth`/`innerHeight` instead, and recompute on browser resize.
- There is no `centerOnScreen()` method on this Webix version despite it being a very findable-sounding API — centering has to be done manually via `win.setPosition((innerWidth - win.$width) / 2, (innerHeight - win.$height) / 2)`, called both after `show()` and on window resize.

No separate thumbnail generation exists — `/api/images/{id}/raw` is used directly for both gallery thumbnails and the detail view's full image.

**Client-side filtering/grouping/search is all in-memory, no server changes.** On load, `app.js` fetches `/api/images/stats` (cheap, populates the loading screen immediately), then fetches the entire listing in one shot from `/api/images/all` into a single `allImages` array before rendering anything — this is deliberate per the feature request ("all computing done in the browser"), not an oversight; there's no server-side date-filter or search endpoint. The `/all` fetch deliberately bypasses `webix.ajax()` in favor of a raw `XMLHttpRequest`, purely to get `onprogress` events (bytes loaded vs. `Content-Length`) for the loading bar — neither `webix.ajax()` nor `fetch()` expose per-chunk progress the same way. Until that fetch resolves, the `#loadingScreen` div in `index.html` — a blinking title, the stats line (folder size / file count / cache date, filled in from the `/stats` response), and the progress bar — is the only thing on screen; `app.js` removes it and only then calls `buildApp()`. A few Lodash-grouping/Webix gotchas worth knowing before touching this:
- Year/month/day grouping (`buildSidebarTree`) uses `item.modified` (parsed once into `_year`/`_month`/`_day` via `withDateParts`, not recomputed per render) and `_.groupBy` + `_.sortBy(..., Number).reverse()` for newest-first ordering — plain `.sort()` on the string keys `_.groupBy` produces would sort lexically, not numerically.
- The sidebar is a Webix `tree` with synthetic ids like `y-2026-m-7-d-15` encoding the filter; `filterFromTreeId` parses that back out. The `"all"` id resets `currentFilter` to `null`. Pagination (`loadPage`) always re-applies `currentFilter` against `allImages` before slicing — there's no server round-trip when the filter or page changes, only when opening a detail view or fetching a raw image.
- The filename search box's suggest dropdown (`webix.ui({view:"suggest", ...})`) is **not** wired to the input via a `master`/`suggest` config — it's a detached popup shown manually via `.show(inputNode)` from the input's `onTimedKeyPress` handler (a real, working debounced-keypress event despite sounding invented). Two non-obvious things here: (1) a bare `webix.ui({view:"suggest", ...})` has no `.parse()`/`.define("data", ...)`-style data methods of its own — you have to reach its internal list via `.getList()` and call `.clearAll()`/`.parse()` on *that*; and (2) `onItemClick` bound on the suggest view itself never fires — it has to be attached to `.getList()` too, otherwise selecting a suggestion just silently free-fills the input with the clicked value (Webix's built-in default) instead of running custom code.
