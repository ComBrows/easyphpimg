# phpimg

A small PHP 7.0 API + [Webix.js](https://webix.com/) front end for browsing a directory of images that is **not** web-accessible on its own. All access goes through this app: it scans the directory once, caches the file list to disk, and serves images and metadata through a JSON API.

## Requirements

- PHP 7.0+ (no Composer, no other dependencies)
- Apache with `mod_rewrite`, or nginx

## Setup

1. Edit `config.php` and set `image_dir` to the absolute path of the directory containing your images. It currently holds a placeholder (`/var/data/images`).
2. Point your web server's document root at `public/`.
   - Apache: the included `public/.htaccess` handles rewriting.
   - nginx:
     ```
     location / {
         try_files $uri $uri/ /index.php?$query_string;
     }
     ```
3. Open the site in a browser — the first request builds `cache/images.json` automatically.

### Local dev

```
php -S 0.0.0.0:8080 -t public
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
