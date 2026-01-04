#!/bin/sh
set -eu

PDF_STORAGE_PATH="${PDF_STORAGE_PATH:-/data/labels}"

# Create storage dir (works for both bind mounts and named volumes)
mkdir -p "$PDF_STORAGE_PATH"

# Fix ownership so the non-root node user can write metadata + PDFs
# (also fixes existing files created as root from earlier runs)
chown -R node:node "$PDF_STORAGE_PATH" || true

# Drop privileges
exec su-exec node node /app/index.js
