# phpimg

A small PHP 7.0 API + [Webix.js](https://webix.com/) front end for browsing a directory of images that is **not** web-accessible on its own. All access goes through this app: it scans the directory once, caches the file list to disk, and serves images and metadata through a JSON API.

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

Each copy is self-contained and works as a subdirectory of the same docroot without any extra web server config — the front controller detects its own base path from `SCRIPT_NAME`.

### Local dev

```
php -S 0.0.0.0:8080
```

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

Each image's `id` is a hash of its filename (`substr(md5($filename), 0, 12)`), so ids stay stable across cache rebuilds.

## Notes

- The directory scan is top-level only — subfolders are not walked.
- `created` in the detail endpoint is the file's inode change time (`ctime`), the closest portable proxy available on Linux — PHP has no true file-birth-time API there.
- No test suite; verify changes with `curl` against the endpoints above and by loading the front end in a browser.

See `CLAUDE.md` for architecture notes and known front-end gotchas.
