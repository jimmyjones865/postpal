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

let metadataWriteInProgress = false;

async function withMetadataLock(fn) {
  while (metadataWriteInProgress) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  metadataWriteInProgress = true;
  try {
    return await fn();
  } finally {
    metadataWriteInProgress = false;
  }
}

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

//async function loadMetadata() {
//  try {
//    const data = await fs.readFile(METADATA_FILE, 'utf-8');
//    return JSON.parse(data);
//  } catch {
//    return { labels: [] };
//  }
//}

async function loadMetadata() {
  try {
    const data = await fs.readFile(METADATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { labels: [] };
    }
    console.error('Metadata file is unreadable or corrupted:', err);
    throw err;
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

// Parse address using libpostal
app.post('/api/parse-address', async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'Missing address field' });
    }
    
    // Import libpostal dynamically (only if available)
    let postal;
    try {
      postal = (await import('node-postal')).default;
    } catch (importErr) {
      console.warn('libpostal not available, using fallback parser');
      return res.status(501).json({ 
        error: 'libpostal not installed',
        message: 'Install node-postal for advanced parsing'
      });
    }
    
    // Parse the address using libpostal
    const parsed = postal.parser.parse_address(address);
    
    // Map libpostal output to our ParsedAddress structure
    // libpostal returns array of { component, label }
    const result = {
      name: '',
      additionalName: '',
      street: '',
      addressLine2: '',
      zip: '',
      city: '',
      country: 'Deutschland'
    };
    
    let houseNumber = '';
    let road = '';
    
    for (const { component, label } of parsed) {
      switch (label) {
        case 'house':
          // Could be person name or company
          if (!result.name) {
            result.name = component;
          } else if (!result.additionalName) {
            result.additionalName = component;
          }
          break;
        case 'house_number':
          houseNumber = component;
          break;
        case 'road':
          road = component;
          break;
        case 'unit':
        case 'level':
        case 'staircase':
        case 'entrance':
          // These go to addressLine2
          if (result.addressLine2) {
            result.addressLine2 += `, ${component}`;
          } else {
            result.addressLine2 = component;
          }
          break;
        case 'postcode':
          result.zip = component;
          break;
        case 'city':
        case 'city_district':
        case 'suburb':
          if (!result.city) {
            result.city = component;
          }
          break;
        case 'country':
          result.country = component;
          break;
        case 'state':
        case 'state_district':
          // Ignore for German addresses
          break;
      }
    }
    
    // Combine street and house number
    if (road && houseNumber) {
      result.street = `${road} ${houseNumber}`;
    } else if (road) {
      result.street = road;
    } else if (houseNumber) {
      result.street = houseNumber;
    }
    
    res.json(result);
  } catch (err) {
    console.error('Failed to parse address:', err);
    res.status(500).json({ error: 'Failed to parse address' });
  }
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
