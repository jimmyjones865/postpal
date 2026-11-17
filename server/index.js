import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './lib/logger.js';

import { createApiRouter } from './routes/api.js';
import { stopCmIntake } from './lib/cm-intake.js';

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
// in-flight requests and the CM poll finish — a purchase may be between DHL charge and PDF storage.
// Below docker-compose stop_grace_period; one order can take several 30 s DHL timeouts.
const SHUTDOWN_TIMEOUT_MS = 150_000;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    logger.info(`[Server] ${signal} received, shutting down`);
    Promise.all([new Promise(resolve => server.close(resolve)), stopCmIntake()])
      .then(() => process.exit(0));
    setTimeout(() => {
      logger.warn('[Server] Shutdown timeout, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  });
}
