/**
 * FEST - Admin Config Routes
 * Algorithm configuration management
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import log from '../../utils/logger';
import { 
  getAlgorithmConfig,
  updateAlgorithmConfigValue,
  deleteLegacyEngineConfig,
} from '../supabase';
import { requireAdminPassword } from '../middleware';

const router = Router();

/** Helper to extract error message from unknown error */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * GET /api/admin/config
 * Get all algorithm configuration parameters
 */
router.get('/', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const config = await getAlgorithmConfig();
    
    res.json({
      success: true,
      count: config.length,
      config: config,
    });
  } catch (error) {
    log.error('Error fetching algorithm config', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte hämta algoritmkonfiguration',
      details: getErrorMessage(error),
    });
  }
});

/**
 * GET /api/admin/config/:key
 * Get a specific configuration parameter
 */
router.get('/:key', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const config = await getAlgorithmConfig();
    const param = config.find(c => c.key === req.params.key);
    
    if (!param) {
      return res.status(404).json({
        success: false,
        error: `Okänd konfigurationsnyckel: ${req.params.key}`,
      });
    }
    
    res.json({
      success: true,
      param: param,
    });
  } catch (error) {
    log.error('Error fetching config param', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte hämta konfigurationsparameter',
      details: getErrorMessage(error),
    });
  }
});

/**
 * PUT /api/admin/config/:key
 * Update a specific configuration parameter
 */
router.put('/:key', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const key = req.params.key;
    const { value } = req.body;
    
    if (value === undefined || value === null) {
      return res.status(400).json({
        success: false,
        error: 'Värde saknas i request body',
      });
    }
    
    const numValue = Number(value);
    if (isNaN(numValue)) {
      return res.status(400).json({
        success: false,
        error: 'Värdet måste vara ett nummer',
      });
    }
    
    await updateAlgorithmConfigValue(key, numValue);
    
    const config = await getAlgorithmConfig();
    const param = config.find(c => c.key === key);
    
    log.info('Konfiguration uppdaterad', { key, value: numValue });
    res.json({
      success: true,
      message: `Konfiguration uppdaterad: ${key} = ${numValue}`,
      param: param,
    });
  } catch (error) {
    log.error('Error updating config', error);
    res.status(400).json({
      success: false,
      error: getErrorMessage(error) || 'Kunde inte uppdatera konfiguration',
    });
  }
});

/**
 * POST /api/admin/config/batch
 * Update multiple configuration parameters at once
 */
router.post('/batch', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const { updates } = req.body;
    
    if (!updates || !Array.isArray(updates)) {
      return res.status(400).json({
        success: false,
        error: 'Request body måste innehålla en "updates" array',
      });
    }
    
    const results: { key: string; success: boolean; error?: string }[] = [];
    
    for (const update of updates) {
      try {
        const numValue = Number(update.value);
        if (isNaN(numValue)) {
          results.push({ key: update.key, success: false, error: 'Ogiltigt nummer' });
          continue;
        }
        
        await updateAlgorithmConfigValue(update.key, numValue);
        results.push({ key: update.key, success: true });
      } catch (err) {
        results.push({ key: update.key, success: false, error: getErrorMessage(err) });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    
    log.info('Batch-uppdatering klar', { successCount, total: updates.length });
    res.json({
      success: successCount === updates.length,
      message: `${successCount} av ${updates.length} uppdateringar lyckades`,
      results: results,
    });
  } catch (error) {
    log.error('Error batch updating config', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte uppdatera konfiguration',
      details: getErrorMessage(error),
    });
  }
});

/**
 * DELETE /api/admin/config/legacy-engine
 * Remove legacy engine config (USE_V5, USE_V6, USE_V7)
 */
router.delete('/legacy-engine', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const deletedCount = await deleteLegacyEngineConfig();
    
    res.json({
      success: true,
      message: `Tog bort ${deletedCount} legacy motorval-konfigurationer`,
      deletedKeys: ['USE_V5', 'USE_V6', 'USE_V7'].slice(0, deletedCount),
    });
  } catch (error) {
    log.error('Error deleting legacy engine config', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte ta bort legacy konfiguration',
      details: getErrorMessage(error),
    });
  }
});

export default router;
