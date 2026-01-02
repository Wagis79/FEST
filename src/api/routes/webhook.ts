/**
 * FEST - M3 Webhook Routes
 * ERP integration for product updates
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import log from '../../utils/logger';
import { updateProductFromM3 } from '../supabase';

const router = Router();

// M3 Webhook secret
const M3_WEBHOOK_SECRET = process.env.M3_WEBHOOK_SECRET || '';

/** Helper to extract error message from unknown error */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * POST /api/webhook/m3-product
 * Update product price/status from M3 ERP system
 */
router.post('/m3-product', async (req: Request, res: Response) => {
  try {
    // Verify webhook secret
    const webhookSecret = req.headers['x-webhook-secret'] as string;
    
    if (!M3_WEBHOOK_SECRET) {
      log.security('M3 webhook: No M3_WEBHOOK_SECRET configured');
      return res.status(503).json({
        success: false,
        error: 'Webhook not configured',
        code: 'WEBHOOK_NOT_CONFIGURED'
      });
    }

    if (!webhookSecret || webhookSecret !== M3_WEBHOOK_SECRET) {
      log.security('M3 webhook: Invalid or missing secret');
      return res.status(401).json({
        success: false,
        error: 'Invalid webhook secret',
        code: 'INVALID_SECRET'
      });
    }

    const { itemNumber, salesPrice, active } = req.body;

    // Validate input
    if (!itemNumber) {
      return res.status(400).json({
        success: false,
        error: 'itemNumber is required',
        code: 'MISSING_ITEM_NUMBER'
      });
    }

    const artikelnr = parseInt(itemNumber.toString().replace('prod-', ''));
    if (isNaN(artikelnr)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid itemNumber format',
        code: 'INVALID_ITEM_NUMBER'
      });
    }

    // Build update object
    const updates: { price?: number; active?: boolean } = {};
    
    if (salesPrice !== undefined) {
      const price = parseFloat(salesPrice);
      if (isNaN(price) || price < 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid salesPrice',
          code: 'INVALID_PRICE'
        });
      }
      // Convert price per ton to price per kg
      updates.price = price / 1000;
    }

    if (active !== undefined) {
      updates.active = Boolean(active);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update (salesPrice or active required)',
        code: 'NO_UPDATES'
      });
    }

    // Update product
    const result = await updateProductFromM3(artikelnr, updates);

    if (!result.found) {
      return res.status(404).json({
        success: false,
        error: `Product with artikelnr ${artikelnr} not found`,
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      message: 'Product updated successfully',
      artikelnr,
      updates
    });

  } catch (error) {
    log.error('M3 webhook error', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: getErrorMessage(error)
    });
  }
});

export default router;
