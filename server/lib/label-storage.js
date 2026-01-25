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
   * Queues a metadata write to ensure sequential execution.
   */
  async function saveMetadata(metadata) {
    writeQueue = writeQueue.then(() => atomicWriteJson(metadataFile, metadata));
    return writeQueue;
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
   * @param {string} pdfBase64 - Base64-encoded PDF content
   * @param {Object} info - Label metadata (recipientAddress, productCode, productName, voucherId, trackId, etc.)
   * @returns {Object} The saved label info including id
   */
  async function saveLabel(pdfBase64, info) {
    await ensureDir();
    
    const now = new Date();
    const timestamp = formatTimestamp(now);
    const namePart = extractRecipientName(info.recipientAddress);
    const idPart = info.trackId || info.voucherId || 'noid';
    
    const id = `label_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const filename = `${timestamp}_${namePart}_${idPart}.pdf`;
    const filepath = path.join(storagePath, filename);
    
    // Write PDF first (can fail without corrupting metadata)
    await fs.writeFile(filepath, Buffer.from(pdfBase64, 'base64'));
    
    // Then update metadata atomically
    const metadata = await loadMetadata();
    const labelInfo = { 
      id, 
      filename, 
      ...info, 
      createdAt: now.toISOString() 
    };
    metadata.labels.unshift(labelInfo);
    await saveMetadata(metadata);
    
    logger.info(`[Storage] Saved label: ${filename}`);
    return labelInfo;
  }

  /**
   * Deletes a label by id.
   * Updates metadata first (source of truth), then attempts to delete the file.
   * 
   * @param {string} id - Label id
   * @returns {boolean} True if label was found and deleted
   */
  async function deleteLabel(id) {
    const metadata = await loadMetadata();
    const idx = metadata.labels.findIndex(l => l.id === id);
    if (idx === -1) {
      return false;
    }
    
    const filename = metadata.labels[idx].filename;
    
    // Update metadata first (most important - source of truth)
    metadata.labels.splice(idx, 1);
    await saveMetadata(metadata);
    
    // Then try to delete file (non-critical if fails)
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
   * Gets the PDF buffer for a label.
   * 
   * @param {string} id - Label id
   * @returns {Buffer|null} PDF buffer or null if not found
   */
  async function getLabelPdf(id) {
    const label = await getLabel(id);
    if (!label) {
      return null;
    }
    return fs.readFile(path.join(storagePath, label.filename));
  }

  /**
   * Gets the full file path for a label PDF.
   * 
   * @param {string} id - Label id
   * @returns {string|null} File path or null if not found
   */
  async function getLabelFilePath(id) {
    const label = await getLabel(id);
    if (!label) {
      return null;
    }
    return path.join(storagePath, label.filename);
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
    
    const metadata = await loadMetadata();
    const maxAge = retentionDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    const toKeep = [];
    const toDelete = [];
    
    for (const label of metadata.labels) {
      const age = now - new Date(label.createdAt).getTime();
      if (age > maxAge) {
        toDelete.push(label);
      } else {
        toKeep.push(label);
      }
    }
    
    // Update metadata first
    metadata.labels = toKeep;
    await saveMetadata(metadata);
    
    // Then delete files
    for (const label of toDelete) {
      try {
        await fs.unlink(path.join(storagePath, label.filename));
        logger.info(`[Cleanup] Deleted: ${label.filename}`);
      } catch (err) {
        logger.warn(`[Cleanup] Could not delete ${label.filename}:`, err.message);
      }
    }
    
    logger.info(`[Cleanup] Complete. Deleted ${toDelete.length}, kept ${toKeep.length}.`);
    return { deleted: toDelete.length, kept: toKeep.length };
  }

  return {
    ensureDir,
    loadMetadata,
    saveLabel,
    deleteLabel,
    getLabel,
    getAllLabels,
    getLabelPdf,
    getLabelFilePath,
    cleanupOldLabels
  };
}
