import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './lib/logger.js';

import { createApiRouter } from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

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

const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Serving static files from: ${STATIC_PATH}`);
});

// Node as container PID 1 ignores SIGTERM by default. Stop accepting connections and let
// in-flight requests finish — a purchase may be between DHL charge and PDF storage.
const SHUTDOWN_TIMEOUT_MS = 25_000;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    logger.info(`[Server] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => {
      logger.warn('[Server] Shutdown timeout, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  });
}
