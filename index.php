<?php

require __DIR__ . '/src/autoload.php';

use App\Cache;
use App\Scanner;
use App\Controllers\ImagesController;

$config = require __DIR__ . '/config.php';

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Find where the API route starts instead of stripping a computed base path
// via SCRIPT_NAME/dirname — that approach breaks under PHP's built-in dev
// server when a router script is used (SCRIPT_NAME there reflects the
// *request* path, not the router's own path). Matching on the literal
// "/api/" marker works identically at any mount depth, under any web
// server, with or without a router script.
$apiPos = strpos($uri, '/api/');

if ($apiPos === false) {
    header('Content-Type: text/html; charset=utf-8');
    readfile(__DIR__ . '/index.html');
    return;
}

$route = substr($uri, $apiPos);

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
    if (preg_match('#^/api/images/file/(.+)$#', $route, $m)) {
        $controller->byFilename(rawurldecode($m[1]));
    } elseif (preg_match('#^/api/images/([a-f0-9]{12})/raw$#', $route, $m)) {
        $controller->raw($m[1]);
    } elseif (preg_match('#^/api/images/([a-f0-9]{12})$#', $route, $m)) {
        $controller->show($m[1]);
    } elseif ($route === '/api/images') {
        $controller->index();
    } else {
        http_response_code(404);
        echo json_encode(array('error' => 'Not found'));
    }
} catch (\Exception $e) {
    http_response_code(500);
    echo json_encode(array('error' => $e->getMessage()));
}
