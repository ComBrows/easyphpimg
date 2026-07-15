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

There is no build step, package manager, or test suite — it's plain PHP 7.0 (no Composer) and a static front end loading Webix from a CDN.

## Commands

- Rebuild the file-list cache after adding/removing images on disk: `php bin/rebuild-cache.php`
- Local dev server: `php -S 0.0.0.0:8080 router.php` (or run the equivalent inside a `php:7.0-cli` Docker container if PHP isn't installed locally — this repo was developed/verified that way). `router.php` is dev-server-only glue — see the routing note below for why it's needed and Apache/nginx don't need it.

There's no automated test suite; verify changes by hitting the endpoints directly (`curl`) and loading `index.html` in a browser.

## Architecture

**Caching is the core design constraint.** The image directory is assumed not to change, so `src/Scanner.php` performs a **non-recursive, top-level-only** filesystem scan exactly once, and `src/Cache.php` persists the result to `cache/images.json`. Every request after that reads the JSON cache instead of touching the filesystem list. To pick up new/removed files, either delete `cache/images.json` or run `bin/rebuild-cache.php`.

**ID scheme:** each image's `id` is `substr(md5($filename), 0, 12)` — a hash of the filename, not a scan-order index. This keeps ids stable across cache rebuilds even if files are added or removed, and matches the route pattern `[a-f0-9]{12}` used by the router.

**Request flow:** `index.php` (project root) is the single front controller. Rather than computing a base path via `SCRIPT_NAME`/`dirname` and stripping it, it just finds the literal `/api/` marker in `REQUEST_URI` and treats everything from there on as the route — this is deliberately robust across Apache, nginx, and PHP's built-in dev server, since `SCRIPT_NAME` behaves inconsistently between them (notably, it reflects the *request* path rather than the executing script's path when the built-in server is run with a router script, which broke the old approach). Given that:
- Any path without `/api/` in it serves `index.html` (the Webix SPA shell) directly.
- Everything from `/api/` onward is matched by hand-rolled regex against `App\Controllers\ImagesController` methods — there is no router class or framework.

`router.php` exists only so `php -S` can be used for local dev at all: without a router script, PHP's built-in server 404s any request whose last path segment looks like a filename (has a dot) before your PHP code ever runs — a real problem given `GET /api/images/file/{filename}` below. Apache/nginx never hit this since `.htaccess`/`try_files` handle the fallback routing themselves.

Class autoloading is a minimal `spl_autoload_register` in `src/autoload.php` mapping the `App\` namespace to `src/` (no Composer).

**Endpoints** (`src/Controllers/ImagesController.php`):
- `GET /api/images?page=&limit=` — paged listing, sourced from the cache, sorted by name.
- `GET /api/images/{id}` — metadata: size, human size, mime, width/height (via `getimagesize`), created/modified. Note `created` uses `ctime` (inode change time) since PHP has no portable file-birth-time API on Linux — it's a best-effort proxy, not a true creation date.
- `GET /api/images/{id}/raw` — streams the actual file bytes with ETag/Last-Modified/304 support and `Content-Disposition: inline`. This is the only endpoint that touches the real file path from `image_dir` for the gallery; everything else works off cached metadata.
- `GET /api/images/file/{filename}` — same metadata as `/{id}`, plus the file's contents inline as `base64`. Looked up by exact filename match against the cache (`Cache::findByName`), not by id. Loads the whole file into memory to encode it, so it's meant for occasional direct lookups, not bulk use.

`src/Cache.php`'s `rebuild()` throws a `RuntimeException` (surfaced as a 500 with a clear message by `index.php`'s catch block) if the cache file can't be written — e.g. wrong permissions on `cache/`. It used to fail silently, leaving `cache/` empty with no indication why; if you see that behavior again, check write permissions before assuming it's a code bug.

**Front end** (`app.js`): a single Webix `dataview` gallery bound to a `pager`, both manually wired (not using Webix's auto-master pager binding). Several non-obvious gotchas if touching this file:
- The `pager` view must have `master: false`, otherwise Webix recomputes page count from the dataview's *currently loaded* record count instead of the server-reported total, which silently caps pagination at 1 page.
- The `onAfterPageChange` handler receives `page` as a **string**. `page + 1` does string concatenation (e.g. `"2" + 1 -> "21"`), not numeric addition — always `parseInt(page, 10) + 1`. The pager's built-in `getPage()` method also doesn't exist despite being a natural guess — use the event argument or `config.page`.
- The `toolbar` and `pager` rows must have an explicit `height`. Without it, with enough images the dataview's natural content height can push the pager out of the layout's calculated space entirely (not just off-screen — genuinely unreachable, no scrollbar). Giving the fixed-height rows an explicit height lets the layout correctly hand the dataview the remaining space as a scrollable region (`scroll: "y"`), keeping the pager permanently visible regardless of item count.
- API/image URLs are built from a `basePath` derived from `app.js`'s own `<script src>` (via `document.querySelector('script[src*="app.js"]')`), not `window.location`. This is what makes a single unmodified `app.js` work correctly under the multi-tenant subdirectory deployments described in Setup — using absolute root paths like `/api/images` previously caused every subdirectory deployment to silently hit the root instance's API instead of its own.

Detail view is a Webix `window` (not `modalbox` — modalbox's positioning has a bug where it can render partially off-screen with taller content, and lacks the layout control needed here) with `gravity: 4` / `gravity: 1` rows for an 80/20 image/metadata split, and a CSS `columns` layout (`.detail-window-meta`) that auto-flows the metadata into 2–3 columns depending on width. Two gotchas specific to this window:
- Webix `window` views don't accept percentage strings for `width`/`height` (unlike `modalbox`) — they throw "Size is not a number". Compute pixel values from `window.innerWidth`/`innerHeight` instead, and recompute on browser resize.
- There is no `centerOnScreen()` method on this Webix version despite it being a very findable-sounding API — centering has to be done manually via `win.setPosition((innerWidth - win.$width) / 2, (innerHeight - win.$height) / 2)`, called both after `show()` and on window resize.

No separate thumbnail generation exists — `/api/images/{id}/raw` is used directly for both gallery thumbnails and the detail view's full image.
