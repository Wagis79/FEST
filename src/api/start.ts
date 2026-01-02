/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 */

import dotenv from 'dotenv';
import app from './server';
import log from '../utils/logger';

dotenv.config();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  log.startup('FEST - Beslutsstöd för gödselrekommendationer');
  log.info('='.repeat(50));
  log.startup(`Server körs på: http://localhost:${PORT}`);
  log.startup(`API: http://localhost:${PORT}/api`);
  log.startup(`Admin: http://localhost:${PORT}/admin.html`);
  log.startup(`Health: http://localhost:${PORT}/health`);
  log.info('='.repeat(50));
  log.startup('Redo att ta emot förfrågningar!');
});
