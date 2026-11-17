import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';

const METADATA_FILENAME = 'labels.json';

/**
 * Creates a label storage manager with atomic file operations.
 * 
 * @param {string} storagePath - Directory path for PDF storage
 * @returns {Object} Storage interface
 */
export function createLabelStorage(storagePath) {
  const metadataFile = path.join(storagePath, METADATA_FILENAME);
  
  // Sequential write queue to prevent race conditions
  let writeQueue = Promise.resolve();

  /**
   * Atomic JSON write: writes to temp file, then renames.
   * This prevents corruption from interrupted writes.
   */
  async function atomicWriteJson(filepath, data) {
    const tempPath = filepath + '.tmp';
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
    await fs.rename(tempPath, filepath);
  }

  /**
   * Ensures the storage directory exists.
   */
  async function ensureDir() {
    await fs.mkdir(storagePath, { recursive: true });
  }

  /**
   * Loads metadata, with recovery from temp file if main file is corrupted.
   */
  async function loadMetadata() {
    try {
      const data = await fs.readFile(metadataFile, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { labels: [] };
      }
      
      // Try to recover from temp file if main file is corrupted
      try {
        const tempPath = metadataFile + '.tmp';
        const tempData = await fs.readFile(tempPath, 'utf-8');
        logger.warn('[Storage] Recovered metadata from temp file');
        const metadata = JSON.parse(tempData);
        // Save recovered data properly
        await atomicWriteJson(metadataFile, metadata);
        return metadata;
      } catch (recoveryErr) {
        logger.error('[Storage] Failed to read metadata:', err);
        logger.error('[Storage] Recovery also failed:', recoveryErr.message);
        throw err;
      }
    }
  }

  /**
   * Runs load → mutate → save as one queued step so concurrent writers can't
   * overwrite each other's changes. `mutate` may return a value, which is passed through.
   */
  function updateMetadata(mutate) {
    const run = writeQueue.then(async () => {
      const metadata = await loadMetadata();
      const result = await mutate(metadata);
      await atomicWriteJson(metadataFile, metadata);
      return result;
    });
    writeQueue = run.catch(() => {});
    return run;
  }

  /**
   * Formats a timestamp as YYYYMMDD_hhmmss.
   */
  function formatTimestamp(date) {
    const pad = n => n.toString().padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
           `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  /**
   * Extracts recipient name from address for filename.
   * Returns first two words as lowercase with special chars stripped.
   */
  function extractRecipientName(address) {
    const firstLine = (address || '').split('\n')[0] || '';
    const words = firstLine.trim().split(/\s+/).slice(0, 2);
    return words
      .map(w => w.toLowerCase().replace(/[^a-z0-9]/gi, ''))
      .filter(Boolean)
      .join('-') || 'unknown';
  }

  /**
   * Saves a new label PDF and updates metadata atomically.
   *
   * @param {Buffer} pdfBuffer - PDF content
   * @param {Object} info - Label metadata (recipientAddress, productCode, productName, voucherId, trackId)
   * @returns {Object} The saved label info including id
   */
  async function saveLabel(pdfBuffer, info) {
    await ensureDir();

    const now = new Date();
    const timestamp = formatTimestamp(now);
    const namePart = extractRecipientName(info.recipientAddress);
    const idPart = info.trackId || info.voucherId || 'noid';

    const id = `label_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const filename = `${timestamp}_${namePart}_${idPart}.pdf`;

    // Write PDF first (can fail without corrupting metadata)
    await fs.writeFile(path.join(storagePath, filename), pdfBuffer);

    const labelInfo = { id, filename, ...info, createdAt: now.toISOString() };
    await updateMetadata(metadata => { metadata.labels.unshift(labelInfo); });

    logger.info(`[Storage] Saved label: ${filename}`);
    return labelInfo;
  }

  /**
   * Merges fields into a label's metadata.
   *
   * @returns {Object|null} Updated label, or null if not found
   */
  async function updateLabel(id, fields) {
    return updateMetadata(metadata => {
      const label = metadata.labels.find(l => l.id === id);
      if (!label) return null;
      Object.assign(label, fields);
      return label;
    });
  }

  /**
   * Deletes a label by id.
   * Updates metadata first (source of truth), then attempts to delete the file.
   * 
   * @param {string} id - Label id
   * @returns {boolean} True if label was found and deleted
   */
  async function deleteLabel(id) {
    // Update metadata first (source of truth), then the file (non-critical if it fails)
    const filename = await updateMetadata(metadata => {
      const idx = metadata.labels.findIndex(l => l.id === id);
      if (idx === -1) return null;
      return metadata.labels.splice(idx, 1)[0].filename;
    });
    if (!filename) return false;

    try {
      await fs.unlink(path.join(storagePath, filename));
      logger.info(`[Storage] Deleted label file: ${filename}`);
    } catch (err) {
      logger.warn(`[Storage] Could not delete file ${filename}:`, err.message);
    }

    return true;
  }

  /**
   * Gets a single label by id.
   * 
   * @param {string} id - Label id
   * @returns {Object|null} Label info or null if not found
   */
  async function getLabel(id) {
    const metadata = await loadMetadata();
    return metadata.labels.find(l => l.id === id) || null;
  }

  /**
   * Gets all stored labels.
   * 
   * @returns {Array} Array of label info objects
   */
  async function getAllLabels() {
    const metadata = await loadMetadata();
    return metadata.labels;
  }

  /**
   * Reads the PDF buffer for a label returned by getLabel().
   *
   * @param {Object} label - Label info
   * @returns {Promise<Buffer>} PDF buffer
   */
  function getLabelPdf(label) {
    return fs.readFile(path.join(storagePath, label.filename));
  }

  /**
   * Cleans up labels older than the retention period.
   * Updates metadata first, then deletes files.
   * 
   * @param {number} retentionDays - Number of days to retain labels
   * @returns {Object} Cleanup stats { deleted, kept }
   */
  async function cleanupOldLabels(retentionDays) {
    logger.info(`[Cleanup] Running for labels older than ${retentionDays} days...`);
    
    const maxAge = retentionDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Update metadata first
    const { toDelete, kept, known } = await updateMetadata(metadata => {
      const toDelete = metadata.labels.filter(l => now - new Date(l.createdAt).getTime() > maxAge);
      metadata.labels = metadata.labels.filter(l => !toDelete.includes(l));
      return { toDelete, kept: metadata.labels.length, known: new Set(metadata.labels.map(l => l.filename)) };
    });

    // Unindexed label files (old PNG format, PDF written but metadata save failed) go by file age
    const orphans = [];
    for (const name of await fs.readdir(storagePath)) {
      if (!/\.(pdf|png)$/.test(name) || known.has(name) || toDelete.some(l => l.filename === name)) continue;
      const { mtimeMs } = await fs.stat(path.join(storagePath, name));
      if (now - mtimeMs > maxAge) orphans.push(name);
    }

    // Then delete files
    for (const filename of [...toDelete.map(l => l.filename), ...orphans]) {
      try {
        await fs.unlink(path.join(storagePath, filename));
        logger.info(`[Cleanup] Deleted: ${filename}`);
      } catch (err) {
        logger.warn(`[Cleanup] Could not delete ${filename}:`, err.message);
      }
    }

    logger.info(`[Cleanup] Complete. Deleted ${toDelete.length} + ${orphans.length} unindexed, kept ${kept}.`);
    return { deleted: toDelete.length + orphans.length, kept };
  }

  return {
    ensureDir,
    saveLabel,
    updateLabel,
    deleteLabel,
    getLabel,
    getAllLabels,
    getLabelPdf,
    cleanupOldLabels
  };
}
