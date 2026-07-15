<?php

namespace App;

class Scanner
{
    /** @var string */
    private $dir;

    /** @var array */
    private $allowedExtensions;

    public function __construct($dir, array $allowedExtensions)
    {
        $this->dir = rtrim($dir, '/');
        $this->allowedExtensions = array_map('strtolower', $allowedExtensions);
    }

    /**
     * Scans the top level of the directory only (no recursion) and returns
     * metadata for every file whose extension is allowed, keyed by id.
     *
     * @return array
     */
    public function scan()
    {
        if (!is_dir($this->dir)) {
            throw new \RuntimeException('Image directory not found: ' . $this->dir);
        }

        $handle = opendir($this->dir);
        if ($handle === false) {
            throw new \RuntimeException('Unable to open image directory: ' . $this->dir);
        }

        $items = array();

        while (($entry = readdir($handle)) !== false) {
            $fullPath = $this->dir . '/' . $entry;
            if (!is_file($fullPath)) {
                continue;
            }

            $extension = strtolower(pathinfo($entry, PATHINFO_EXTENSION));
            if (!in_array($extension, $this->allowedExtensions, true)) {
                continue;
            }

            // Hash of the filename, not scan order, so ids stay stable
            // across rebuilds even if files are added/removed elsewhere.
            $id = substr(md5($entry), 0, 12);

            $items[$id] = array(
                'id' => $id,
                'name' => $entry,
                'extension' => $extension,
                'size' => filesize($fullPath),
                'mtime' => filemtime($fullPath),
                'ctime' => filectime($fullPath),
            );
        }

        closedir($handle);

        return $items;
    }
}
