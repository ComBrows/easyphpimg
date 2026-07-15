<?php

require __DIR__ . '/../src/autoload.php';

use App\Cache;
use App\Scanner;
use App\Controllers\ImagesController;

$config = require __DIR__ . '/../config.php';

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Strip the app's base path so this works whether it's mounted at / or in a
// subdirectory (e.g. behind an alias).
$scriptDir = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/');
if ($scriptDir !== '' && strpos($uri, $scriptDir) === 0) {
    $uri = substr($uri, strlen($scriptDir));
}
$uri = '/' . trim($uri, '/');

if (strpos($uri, '/api/') !== 0) {
    header('Content-Type: text/html; charset=utf-8');
    readfile(__DIR__ . '/index.html');
    return;
}

$scanner = new Scanner($config['image_dir'], $config['allowed_extensions']);
$cache = new Cache($config['cache_file'], $scanner);
$controller = new ImagesController(
    $cache,
    $config['image_dir'],
    $config['default_page_size'],
    $config['max_page_size']
);

header('Content-Type: application/json');

try {
    if (preg_match('#^/api/images/([a-f0-9]{12})/raw$#', $uri, $m)) {
        $controller->raw($m[1]);
    } elseif (preg_match('#^/api/images/([a-f0-9]{12})$#', $uri, $m)) {
        $controller->show($m[1]);
    } elseif ($uri === '/api/images') {
        $controller->index();
    } else {
        http_response_code(404);
        echo json_encode(array('error' => 'Not found'));
    }
} catch (\Exception $e) {
    http_response_code(500);
    echo json_encode(array('error' => $e->getMessage()));
}
