<?php

require __DIR__ . '/../src/autoload.php';

use App\Cache;
use App\Scanner;

$config = require __DIR__ . '/../config.php';

$scanner = new Scanner($config['image_dir'], $config['allowed_extensions']);
$cache = new Cache($config['cache_file'], $scanner);

$items = $cache->rebuild();

echo 'Rebuilt cache with ' . count($items) . " item(s).\n";
