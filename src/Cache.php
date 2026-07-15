<?php

namespace App;

class Cache
{
    /** @var string */
    private $cacheFile;

    /** @var Scanner */
    private $scanner;

    public function __construct($cacheFile, Scanner $scanner)
    {
        $this->cacheFile = $cacheFile;
        $this->scanner = $scanner;
    }

    /**
     * Returns the cached item list, building it from disk on first use.
     * The directory is only scanned once; every later call reads this file.
     *
     * @return array
     */
    public function items()
    {
        if (is_file($this->cacheFile)) {
            $decoded = json_decode(file_get_contents($this->cacheFile), true);
            if (is_array($decoded) && isset($decoded['items'])) {
                return $decoded['items'];
            }
        }

        return $this->rebuild();
    }

    /**
     * Forces a fresh directory scan and overwrites the cache file. Call this
     * (or bin/rebuild-cache.php) after adding/removing files on disk.
     *
     * @return array
     */
    public function rebuild()
    {
        $items = $this->scanner->scan();

        $payload = json_encode(array(
            'generated_at' => time(),
            'count' => count($items),
            'items' => $items,
        ));

        $dir = dirname($this->cacheFile);
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new \RuntimeException('Cache directory does not exist and could not be created: ' . $dir);
        }

        // Write to a temp file and rename so concurrent readers never see a
        // partially-written cache file.
        $tmpFile = $this->cacheFile . '.' . uniqid('', true) . '.tmp';
        if (file_put_contents($tmpFile, $payload, LOCK_EX) === false) {
            throw new \RuntimeException('Unable to write cache file — check that ' . $dir . ' is writable by the web server user: ' . $tmpFile);
        }
        if (!rename($tmpFile, $this->cacheFile)) {
            @unlink($tmpFile);
            throw new \RuntimeException('Unable to move cache file into place: ' . $this->cacheFile);
        }

        return $items;
    }

    public function find($id)
    {
        $items = $this->items();

        return isset($items[$id]) ? $items[$id] : null;
    }

    public function findByName($name)
    {
        foreach ($this->items() as $item) {
            if ($item['name'] === $name) {
                return $item;
            }
        }

        return null;
    }
}
