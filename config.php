<?php
return array(
    // Absolute path to the directory containing images. This directory must
    // NOT be exposed directly by nginx/apache — all access goes through the
    // API below (specifically the /raw endpoint).
    'image_dir' => '/var/data/images',

    // Allowed image extensions (lowercase, without the dot). Anything else
    // in image_dir is ignored by the scanner.
    'allowed_extensions' => array('jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'),

    // Where the file-list cache is stored. The directory scan only runs
    // once to build this file; subsequent requests read from it. Delete the
    // file (or run bin/rebuild-cache.php) to pick up changes on disk.
    'cache_file' => __DIR__ . '/cache/images.json',

    // Default / max items per page for GET /api/images.
    'default_page_size' => 24,
    'max_page_size' => 200,

    // How long (seconds) a cache is trusted before its next read triggers a
    // cheap re-scan to check whether the folder actually changed. The
    // directory isn't expected to change daily, and up to 24h of staleness
    // is acceptable, so this avoids re-scanning on every request.
    'cache_ttl' => 86400,
);
