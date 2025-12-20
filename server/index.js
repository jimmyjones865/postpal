import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configuration from environment variables
const PDF_STORAGE_PATH = process.env.PDF_STORAGE_PATH || '/data/labels';
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '60', 10);
const PORT = process.env.API_PORT || 3001;

// Ensure storage directory exists
async function ensureStorageDir() {
  try {
    await fs.mkdir(PDF_STORAGE_PATH, { recursive: true });
  } catch (err) {
    console.error('Failed to create storage directory:', err);
  }
}

// Label metadata storage (JSON file)
const METADATA_FILE = path.join(PDF_STORAGE_PATH, 'labels.json');

async function loadMetadata() {
  try {
    const data = await fs.readFile(METADATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { labels: [] };
  }
}

async function saveMetadata(metadata) {
  await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2));
}

// Cleanup old labels
async function cleanupOldLabels() {
  console.log(`Running cleanup for labels older than ${RETENTION_DAYS} days...`);
  const metadata = await loadMetadata();
  const now = Date.now();
  const maxAge = RETENTION_DAYS * 24 * 60 * 60 * 1000;
  
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
  
  // Delete old PDF files
  for (const label of toDelete) {
    try {
      await fs.unlink(path.join(PDF_STORAGE_PATH, label.filename));
      console.log(`Deleted old label: ${label.filename}`);
    } catch (err) {
      console.error(`Failed to delete ${label.filename}:`, err.message);
    }
  }
  
  metadata.labels = toKeep;
  await saveMetadata(metadata);
  console.log(`Cleanup complete. Deleted ${toDelete.length} labels, kept ${toKeep.length}.`);
}

// API Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', storagePath: PDF_STORAGE_PATH, retentionDays: RETENTION_DAYS });
});

// Save a new label
app.post('/api/labels', async (req, res) => {
  try {
    const { pdfBase64, recipientAddress, productCode, productName, einschreiben } = req.body;
    
    if (!pdfBase64 || !recipientAddress || !productCode) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const id = `label_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const filename = `${id}.pdf`;
    const filepath = path.join(PDF_STORAGE_PATH, filename);
    
    // Decode and save PDF
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    await fs.writeFile(filepath, pdfBuffer);
    
    // Update metadata
    const metadata = await loadMetadata();
    const labelInfo = {
      id,
      filename,
      recipientAddress,
      productCode,
      productName,
      einschreiben: einschreiben || false,
      createdAt: new Date().toISOString(),
    };
    metadata.labels.unshift(labelInfo); // Most recent first
    await saveMetadata(metadata);
    
    console.log(`Saved label: ${filename}`);
    res.json({ success: true, label: labelInfo });
  } catch (err) {
    console.error('Failed to save label:', err);
    res.status(500).json({ error: 'Failed to save label' });
  }
});

// Get all labels
app.get('/api/labels', async (req, res) => {
  try {
    const metadata = await loadMetadata();
    res.json(metadata.labels);
  } catch (err) {
    console.error('Failed to get labels:', err);
    res.status(500).json({ error: 'Failed to get labels' });
  }
});

// Get a specific label PDF
app.get('/api/labels/:id/pdf', async (req, res) => {
  try {
    const metadata = await loadMetadata();
    const label = metadata.labels.find(l => l.id === req.params.id);
    
    if (!label) {
      return res.status(404).json({ error: 'Label not found' });
    }
    
    const filepath = path.join(PDF_STORAGE_PATH, label.filename);
    const pdfBuffer = await fs.readFile(filepath);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${label.filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Failed to get PDF:', err);
    res.status(500).json({ error: 'Failed to get PDF' });
  }
});

// Delete a label
app.delete('/api/labels/:id', async (req, res) => {
  try {
    const metadata = await loadMetadata();
    const labelIndex = metadata.labels.findIndex(l => l.id === req.params.id);
    
    if (labelIndex === -1) {
      return res.status(404).json({ error: 'Label not found' });
    }
    
    const label = metadata.labels[labelIndex];
    
    // Delete PDF file
    try {
      await fs.unlink(path.join(PDF_STORAGE_PATH, label.filename));
    } catch (err) {
      console.warn(`Could not delete file ${label.filename}:`, err.message);
    }
    
    // Remove from metadata
    metadata.labels.splice(labelIndex, 1);
    await saveMetadata(metadata);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to delete label:', err);
    res.status(500).json({ error: 'Failed to delete label' });
  }
});

// Start server
await ensureStorageDir();
app.listen(PORT, () => {
  console.log(`Label storage API running on port ${PORT}`);
  console.log(`Storage path: ${PDF_STORAGE_PATH}`);
  console.log(`Retention: ${RETENTION_DAYS} days`);
});

// Run cleanup on startup and every 24 hours
cleanupOldLabels();
setInterval(cleanupOldLabels, 24 * 60 * 60 * 1000);
