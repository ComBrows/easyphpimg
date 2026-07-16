<?php

namespace App;

class Cache
{
    /** @var string */
    private $cacheFile;

    /** @var Scanner */
    private $scanner;

    /** @var int */
    private $staleTtl;

    public function __construct($cacheFile, Scanner $scanner, $staleTtl = 86400)
    {
        $this->cacheFile = $cacheFile;
        $this->scanner = $scanner;
        $this->staleTtl = $staleTtl;
    }

    /**
     * Returns the cached item list, building it from disk on first use and
     * refreshing per the staleness rule documented on currentPayload().
     *
     * @return array
     */
    public function items()
    {
        return $this->currentPayload()['items'];
    }

    /**
     * Cheap summary (count / total size / cache age) for the front end's
     * initial loading-screen stats — shares the same staleness check as
     * items(), so it never reports numbers older than items()/all() would.
     *
     * @return array
     */
    public function stats()
    {
        $payload = $this->currentPayload();

        return array(
            'count' => $payload['count'],
            'total_size' => $payload['total_size'],
            'generated_at' => $payload['generated_at'],
        );
    }

    /**
     * Forces a fresh directory scan and overwrites the cache file. Call this
     * (or bin/rebuild-cache.php) after adding/removing files on disk.
     *
     * @return array
     */
    public function rebuild()
    {
        return $this->rebuildWith($this->scanner->scan())['items'];
    }

    /**
     * Returns the current cache payload, building it on first use. Once
     * cached, entries older than $staleTtl trigger a fresh stat-only scan
     * whose signature is compared against the stored one — only a real
     * change (add/remove/replace) triggers a full rebuild; otherwise just
     * generated_at is bumped so the next check waits another full TTL.
     *
     * @return array
     */
    private function currentPayload()
    {
        $payload = $this->readPayload();

        if ($payload === null) {
            return $this->rebuildWith($this->scanner->scan());
        }

        if ((time() - $payload['generated_at']) > $this->staleTtl) {
            $freshItems = $this->scanner->scan();
            $freshSignature = $this->computeSignature($freshItems);

            if ($freshSignature !== $payload['signature']) {
                return $this->rebuildWith($freshItems, $freshSignature);
            }

            $payload['generated_at'] = time();
            $this->writePayload($payload);
        }

        return $payload;
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

    private function rebuildWith(array $items, $signature = null)
    {
        if ($signature === null) {
            $signature = $this->computeSignature($items);
        }

        $totalSize = 0;
        foreach ($items as $item) {
            $totalSize += $item['size'];
        }

        $payload = array(
            'generated_at' => time(),
            'count' => count($items),
            'total_size' => $totalSize,
            'signature' => $signature,
            'items' => $items,
        );

        $this->writePayload($payload);

        return $payload;
    }

    /**
     * Signature of the folder's contents — a hash of every file's
     * name/size/mtime, sorted so scan order doesn't matter. PHP has no
     * direct "hash a directory" primitive, so this is the stat-only proxy:
     * cheap (no file reads) and changes on any add/remove/replace.
     */
    private function computeSignature(array $items)
    {
        $parts = array();
        foreach ($items as $item) {
            $parts[] = $item['name'] . ':' . $item['size'] . ':' . $item['mtime'];
        }
        sort($parts);

        return md5(implode('|', $parts));
    }

    private function readPayload()
    {
        if (!is_file($this->cacheFile)) {
            return null;
        }

        $decoded = json_decode(file_get_contents($this->cacheFile), true);
        if (!is_array($decoded) || !isset($decoded['items'], $decoded['signature'], $decoded['generated_at'])) {
            // Also covers cache files written before the signature field
            // existed — treated as absent so the next call rebuilds them.
            return null;
        }

        return $decoded;
    }

    private function writePayload(array $payload)
    {
        $json = json_encode($payload);

        $dir = dirname($this->cacheFile);
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new \RuntimeException('Cache directory does not exist and could not be created: ' . $dir);
        }

        // Write to a temp file and rename so concurrent readers never see a
        // partially-written cache file.
        $tmpFile = $this->cacheFile . '.' . uniqid('', true) . '.tmp';
        if (file_put_contents($tmpFile, $json, LOCK_EX) === false) {
            throw new \RuntimeException('Unable to write cache file — check that ' . $dir . ' is writable by the web server user: ' . $tmpFile);
        }
        if (!rename($tmpFile, $this->cacheFile)) {
            @unlink($tmpFile);
            throw new \RuntimeException('Unable to move cache file into place: ' . $this->cacheFile);
        }
    }
}
