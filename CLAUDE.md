# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small PHP 7.0 API + Webix.js front end that browses a directory of images which is intentionally **not** web-accessible (not served directly by nginx/apache). All access goes through this app, which reads the directory once, caches the file list to disk, and serves images and metadata through a JSON API.

## Setup

Edit `config.php` — in particular `image_dir`, which must point to the absolute path of the directory containing images. It currently holds a placeholder (`/var/data/images`).

Point your web server's document root at `public/`. An `.htaccess` (Apache, `mod_rewrite`) is included to route all non-file requests to `public/index.php`. For nginx, use:

```
location / {
    try_files $uri $uri/ /index.php?$query_string;
}
```

There is no build step, package manager, or test suite — it's plain PHP 7.0 (no Composer) and a static front end loading Webix from a CDN.

## Commands

- Rebuild the file-list cache after adding/removing images on disk: `php bin/rebuild-cache.php`
- Local dev server: `php -S 0.0.0.0:8080 -t public` (or run the equivalent inside a `php:7.0-cli` Docker container if PHP isn't installed locally — this repo was developed/verified that way).

There's no automated test suite; verify changes by hitting the endpoints directly (`curl`) and loading `public/index.html` in a browser.

## Architecture

**Caching is the core design constraint.** The image directory is assumed not to change, so `src/Scanner.php` performs a **non-recursive, top-level-only** filesystem scan exactly once, and `src/Cache.php` persists the result to `cache/images.json`. Every request after that reads the JSON cache instead of touching the filesystem list. To pick up new/removed files, either delete `cache/images.json` or run `bin/rebuild-cache.php`.

**ID scheme:** each image's `id` is `substr(md5($filename), 0, 12)` — a hash of the filename, not a scan-order index. This keeps ids stable across cache rebuilds even if files are added or removed, and matches the route pattern `[a-f0-9]{12}` used by the router.

**Request flow:** `public/index.php` is the single front controller. It strips the script's base path from `REQUEST_URI`, and:
- Any path not starting with `/api/` serves `public/index.html` (the Webix SPA shell) directly.
- `/api/` paths are matched by hand-rolled regex against `App\Controllers\ImagesController` methods — there is no router class or framework.

Class autoloading is a minimal `spl_autoload_register` in `src/autoload.php` mapping the `App\` namespace to `src/` (no Composer).

**Endpoints** (`src/Controllers/ImagesController.php`):
- `GET /api/images?page=&limit=` — paged listing, sourced from the cache, sorted by name.
- `GET /api/images/{id}` — metadata: size, human size, mime, width/height (via `getimagesize`), created/modified. Note `created` uses `ctime` (inode change time) since PHP has no portable file-birth-time API on Linux — it's a best-effort proxy, not a true creation date.
- `GET /api/images/{id}/raw` — streams the actual file bytes with ETag/Last-Modified/304 support and `Content-Disposition: inline`. This is the only endpoint that touches the real file path from `image_dir`; everything else works off cached metadata.

**Front end** (`public/app.js`): a single Webix `dataview` gallery bound to a `pager`, both manually wired (not using Webix's auto-master pager binding). Two non-obvious gotchas if touching this file:
- The `pager` view must have `master: false`, otherwise Webix recomputes page count from the dataview's *currently loaded* record count instead of the server-reported total, which silently caps pagination at 1 page.
- The `onAfterPageChange` handler receives `page` as a **string**. `page + 1` does string concatenation (e.g. `"2" + 1 -> "21"`), not numeric addition — always `parseInt(page, 10) + 1`. This was a real bug found via browser testing; the pager's built-in `getPage()` method also doesn't exist despite being a natural guess — use the event argument or `config.page`.

Detail view is a `webix.modalbox` fetching `/api/images/{id}` and embedding `/api/images/{id}/raw` as the preview image — no separate thumbnail generation exists; the raw endpoint is used directly for both gallery thumbnails and full previews.
