/**
 * FEST - Health Check Route
 */

import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

/**
 * GET /health
 * Health check endpoint
 */
router.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    status: 'OK',
    timestamp: new Date().toISOString(),
  });
});

export default router;
