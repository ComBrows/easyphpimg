<?php

// Router for PHP's built-in dev server (php -S host:port router.php).
// Not used in production — Apache/nginx route via .htaccess / try_files
// instead. Without this, the built-in server 404s any request whose last
// path segment looks like a filename (e.g. /api/images/file/photo.jpg)
// instead of falling through to index.php.

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if ($path !== '/' && is_file(__DIR__ . $path)) {
    return false;
}

require __DIR__ . '/index.php';
