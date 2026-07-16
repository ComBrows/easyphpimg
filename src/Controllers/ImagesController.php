<?php

namespace App\Controllers;

use App\Cache;

class ImagesController
{
    /** @var Cache */
    private $cache;

    /** @var string */
    private $imageDir;

    /** @var int */
    private $defaultPageSize;

    /** @var int */
    private $maxPageSize;

    public function __construct(Cache $cache, $imageDir, $defaultPageSize, $maxPageSize)
    {
        $this->cache = $cache;
        $this->imageDir = rtrim($imageDir, '/');
        $this->defaultPageSize = $defaultPageSize;
        $this->maxPageSize = $maxPageSize;
    }

    /** GET /api/images */
    public function index()
    {
        $items = array_values($this->cache->items());
        usort($items, function ($a, $b) {
            return strcasecmp($a['name'], $b['name']);
        });

        $total = count($items);
        $limit = isset($_GET['limit']) ? (int) $_GET['limit'] : $this->defaultPageSize;
        $limit = max(1, min($limit, $this->maxPageSize));
        $page = isset($_GET['page']) ? max(1, (int) $_GET['page']) : 1;
        $offset = ($page - 1) * $limit;

        $slice = array_slice($items, $offset, $limit);
        $data = array_map(array($this, 'toSummary'), $slice);

        $this->json(array(
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'total_pages' => $total > 0 ? (int) ceil($total / $limit) : 0,
            'items' => $data,
        ));
    }

    /**
     * GET /api/images/all — the entire listing in one response, so the
     * front end can load everything with a single (gzip-compressed) request
     * instead of paginating through hundreds of them at scale.
     */
    public function all()
    {
        $items = array_values($this->cache->items());
        usort($items, function ($a, $b) {
            return strcasecmp($a['name'], $b['name']);
        });

        $stats = $this->cache->stats();

        $this->json(array(
            'generated_at' => date('c', $stats['generated_at']),
            'count' => count($items),
            'total_size' => $stats['total_size'],
            'total_size_human' => $this->humanSize($stats['total_size']),
            'items' => array_map(array($this, 'toSummary'), $items),
        ));
    }

    /**
     * GET /api/images/stats — cheap count/size/cache-age summary, fetched
     * first so the loading screen can show it before the full listing
     * (which is the larger, slower request) arrives.
     */
    public function stats()
    {
        $stats = $this->cache->stats();

        $this->json(array(
            'count' => $stats['count'],
            'total_size' => $stats['total_size'],
            'total_size_human' => $this->humanSize($stats['total_size']),
            'generated_at' => date('c', $stats['generated_at']),
        ));
    }

    /** GET /api/images/{id} */
    public function show($id)
    {
        $item = $this->cache->find($id);
        if ($item === null) {
            $this->json(array('error' => 'Not found'), 404);
            return;
        }

        $this->json($this->toDetail($item));
    }

    /** GET /api/images/file/{filename} */
    public function byFilename($filename)
    {
        $item = $this->cache->findByName($filename);
        if ($item === null) {
            $this->json(array('error' => 'Not found'), 404);
            return;
        }

        $path = $this->imageDir . '/' . $item['name'];
        if (!is_file($path)) {
            $this->json(array('error' => 'File missing on disk'), 410);
            return;
        }

        $detail = $this->toDetail($item);
        $detail['base64'] = base64_encode(file_get_contents($path));

        $this->json($detail);
    }

    /** GET /api/images/{id}/raw */
    public function raw($id)
    {
        $item = $this->cache->find($id);
        if ($item === null) {
            $this->json(array('error' => 'Not found'), 404);
            return;
        }

        $path = $this->imageDir . '/' . $item['name'];
        if (!is_file($path)) {
            $this->json(array('error' => 'File missing on disk'), 410);
            return;
        }

        $etag = '"' . md5($item['name'] . $item['size'] . $item['mtime']) . '"';
        $lastModified = gmdate('D, d M Y H:i:s', $item['mtime']) . ' GMT';

        $ifNoneMatch = isset($_SERVER['HTTP_IF_NONE_MATCH']) ? $_SERVER['HTTP_IF_NONE_MATCH'] : null;
        if ($ifNoneMatch === $etag) {
            header('HTTP/1.1 304 Not Modified');
            header('ETag: ' . $etag);
            return;
        }

        header('Content-Type: ' . $this->mimeType($path, $item['extension']));
        header('Content-Length: ' . $item['size']);
        header('ETag: ' . $etag);
        header('Last-Modified: ' . $lastModified);
        header('Cache-Control: public, max-age=86400');
        header('Content-Disposition: inline; filename="' . $item['name'] . '"');

        readfile($path);
    }

    private function toSummary(array $item)
    {
        return array(
            'id' => $item['id'],
            'name' => $item['name'],
            'extension' => $item['extension'],
            'size' => $item['size'],
            'modified' => date('c', $item['mtime']),
        );
    }

    private function toDetail(array $item)
    {
        $path = $this->imageDir . '/' . $item['name'];
        $width = null;
        $height = null;

        if (is_file($path)) {
            $info = @getimagesize($path);
            if ($info !== false) {
                $width = $info[0];
                $height = $info[1];
            }
        }

        return array(
            'id' => $item['id'],
            'name' => $item['name'],
            'extension' => $item['extension'],
            'mime' => $this->mimeType($path, $item['extension']),
            'size' => $item['size'],
            'size_human' => $this->humanSize($item['size']),
            'width' => $width,
            'height' => $height,
            // NOTE: PHP has no portable "birth time" API on Linux — ctime
            // here is the inode change time, the closest available proxy.
            'created' => date('c', $item['ctime']),
            'modified' => date('c', $item['mtime']),
        );
    }

    private function mimeType($path, $extension)
    {
        if (is_file($path) && function_exists('finfo_open')) {
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            $mime = finfo_file($finfo, $path);
            finfo_close($finfo);
            if ($mime) {
                return $mime;
            }
        }

        $map = array(
            'jpg' => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'gif' => 'image/gif',
            'webp' => 'image/webp',
            'bmp' => 'image/bmp',
        );

        return isset($map[$extension]) ? $map[$extension] : 'application/octet-stream';
    }

    private function humanSize($bytes)
    {
        $units = array('B', 'KB', 'MB', 'GB');
        $bytes = max($bytes, 0);
        $pow = $bytes ? floor(log($bytes) / log(1024)) : 0;
        $pow = min($pow, count($units) - 1);
        $bytes /= pow(1024, $pow);

        return round($bytes, 2) . ' ' . $units[$pow];
    }

    private function json($data, $status = 200)
    {
        http_response_code($status);
        header('Content-Type: application/json');
        echo json_encode($data);
    }
}
