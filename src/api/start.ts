/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 */

import dotenv from 'dotenv';
import type { Server } from 'http';
import app from './server';
import log from '../utils/logger';
import { getHighsPool } from '../engine/highs-pool';

dotenv.config();

const PORT = process.env.PORT || 3000;

let server: Server | null = null;

// Graceful shutdown handler
async function shutdown(signal: string) {
  log.info(`${signal} mottaget, stänger av servern...`);
  
  // Stäng HTTP-servern först (sluta acceptera nya anslutningar)
  if (server) {
    server.close(() => {
      log.info('HTTP-server stängd');
    });
  }
  
  // Stäng HiGHS worker pool
  try {
    const pool = getHighsPool();
    await pool.shutdown();
    log.info('HiGHS worker pool stängd');
  } catch (err) {
    log.warn('Kunde inte stänga HiGHS pool', { error: String(err) });
  }
  
  log.info('Servern avstängd');
  process.exit(0);
}

// Registrera signal handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Fånga uncaught exceptions
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', err);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', reason as Error);
});

server = app.listen(PORT, () => {
  log.startup('FEST - Beslutsstöd för gödselrekommendationer');
  log.info('='.repeat(50));
  log.startup(`Server körs på: http://localhost:${PORT}`);
  log.startup(`API: http://localhost:${PORT}/api`);
  log.startup(`Admin: http://localhost:${PORT}/admin.html`);
  log.startup(`Health: http://localhost:${PORT}/health`);
  log.info('='.repeat(50));
  log.startup('Redo att ta emot förfrågningar!');
});
