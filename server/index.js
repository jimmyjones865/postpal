import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './lib/logger.js';

// Import API routes (modular for potential future split)
import { createApiRouter } from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configuration from environment variables
const PORT = process.env.PORT || 3000;
const STATIC_PATH = process.env.STATIC_PATH || path.join(__dirname, 'public');

// Mount API routes
app.use('/api', createApiRouter());

// Serve static files (built frontend)
app.use(express.static(STATIC_PATH));

// SPA fallback - serve index.html for all non-API routes
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(STATIC_PATH, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Serving static files from: ${STATIC_PATH}`);
});
