# phpimg

A small PHP 7.0 API + [Webix.js](https://webix.com/) front end for browsing a directory of images that is **not** web-accessible on its own. All access goes through this app: it scans the directory once, caches the file list to disk, and serves images and metadata through a JSON API.

The front end loads the full listing once and does all filtering, year/month/day grouping (via [Lodash](https://lodash.com/)), pagination, and filename search client-side — the server only paginates the raw listing and streams individual files.

## Requirements

- PHP 7.0+ (no Composer, no other dependencies)
- Apache with `mod_rewrite`, or nginx

## Setup

The whole project folder is the document root — no `public/` subpath to configure. Drop it anywhere your web server serves from.

1. Edit `config.php` and set `image_dir` to the absolute path of the directory containing your images. It currently holds a placeholder (`/var/data/images`).
2. Point your web server's document root (or a subdirectory alias) at the project folder.
   - Apache: the included `.htaccess` handles rewriting and blocks direct access to `config.php`, `src/`, `cache/`, and `bin/`.
   - nginx:
     ```
     location ~ ^/(config\.php|src/|cache/|bin/) {
         deny all;
         return 403;
     }

     location / {
         try_files $uri $uri/ /index.php?$query_string;
     }

     location ~ \.php$ {
         # ... your fastcgi_pass / fastcgi_param SCRIPT_FILENAME setup
     }
     ```
3. Open the site in a browser — the first request builds `cache/images.json` automatically.

### Multiple image folders on one server

Since each deployment is just this folder with its own `config.php`, serving several unrelated image directories (e.g. `/img/custa`, `/img/custb`) means copying the whole project once per directory, each with a different `image_dir`:

```
/var/www/html/custa/   (full copy of this project, image_dir = /img/custa)
/var/www/html/custb/   (full copy of this project, image_dir = /img/custb)
```

Each copy is self-contained and works as a subdirectory of the same docroot without any extra web server config — `index.php` matches routes on the literal `/api/` marker in the request path rather than a computed base path, so it works unmodified at any mount depth.

### Local dev

```
php -S 0.0.0.0:8080 router.php
```

`router.php` is only needed for PHP's built-in dev server — without it, any request whose last path segment looks like a filename (e.g. `/api/images/file/photo.jpg`) 404s before ever reaching `index.php`. Apache/nginx don't have this problem since they route via `.htaccess`/`try_files` instead.

If you don't have PHP installed locally, run the same command inside a `php:7.0-cli` Docker container with the project mounted in.

## Rebuilding the cache

The image directory is assumed not to change, so it's only scanned once and cached to `cache/images.json`. After adding or removing files on disk, refresh the cache with:

```
php bin/rebuild-cache.php
```

(or just delete `cache/images.json`, which triggers a rebuild on the next request).

## API

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/api/images?page=&limit=` | Paged listing, sorted by name |
| GET | `/api/images/{id}` | Metadata: size, mime, width/height, created/modified |
| GET | `/api/images/{id}/raw` | Streams the raw file bytes (ETag / 304 support) |
| GET | `/api/images/file/{filename}` | Metadata + the file's contents inline as base64 (URL-encode the filename) |

Each image's `id` is a hash of its filename (`substr(md5($filename), 0, 12)`), so ids stay stable across cache rebuilds. The `file/{filename}` endpoint loads the whole file into memory to base64-encode it — fine for occasional lookups, but prefer `/{id}/raw` for the gallery itself.

## Front end features

- **Sidebar**: images grouped by year → month → day (from each file's `modified` date), click any node to filter the gallery; "All images" clears the filter.
- **Search**: type 3+ characters in the toolbar search box for filename suggestions; selecting one opens that image's detail view directly.
- **Detail view**: click any thumbnail for a centered window with the image on top and metadata below.
- A "Loading…" screen shows until the full listing has been fetched, since nothing else can render (grouping, search, and pagination all need the complete list first).

## Notes

- The directory scan is top-level only — subfolders are not walked.
- `created` in the detail endpoint is the file's inode change time (`ctime`), the closest portable proxy available on Linux — PHP has no true file-birth-time API there.
- No test suite; verify changes with `curl` against the endpoints above and by loading the front end in a browser.

See `CLAUDE.md` for architecture notes and known front-end gotchas.
