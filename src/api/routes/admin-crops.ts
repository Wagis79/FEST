/**
 * FEST - Admin Crops Routes
 * CRUD operations for crops
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import log from '../../utils/logger';
import { 
  getAllCropsRaw,
  createCrop,
  updateCrop,
  deleteCrop,
} from '../supabase';
import { requireAdminPassword } from '../middleware';

const router = Router();

/** Helper to extract error message from unknown error */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * GET /api/admin/crops
 * Get all crops (raw database format)
 */
router.get('/', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const crops = await getAllCropsRaw();
    res.json(crops);
  } catch (error) {
    log.error('Error fetching crops', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte hämta grödor',
      details: getErrorMessage(error),
    });
  }
});

/**
 * POST /api/admin/crops
 * Create a new crop
 */
router.post('/', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    if (!req.body.id) {
      return res.status(400).json({
        success: false,
        error: 'ID är obligatoriskt (id) - använd beskrivande format, t.ex. "spring_barley_malt"',
      });
    }
    if (!req.body.name) {
      return res.status(400).json({
        success: false,
        error: 'Namn är obligatoriskt (name)',
      });
    }
    
    const cropData = {
      id: req.body.id,
      name: req.body.name,
      category: req.body.category || 'other',
      unit: req.body.unit || 'ton',
      n_per_ton: req.body.n_per_ton ?? 0,
      p_per_ton: req.body.p_per_ton ?? 0,
      k_per_ton: req.body.k_per_ton ?? 0,
      s_per_ton: req.body.s_per_ton || null,
      yield_min: req.body.yield_min ?? 0,
      yield_max: req.body.yield_max ?? 10,
      yield_average: req.body.yield_average ?? 5,
      precrop_n_effect: req.body.precrop_n_effect ?? 0,
      precrop_yield_effect: req.body.precrop_yield_effect ?? 0,
      description: req.body.description || null,
      source_provider: req.body.source_provider || 'Manuellt tillagd',
      source_note: req.body.source_note || null,
    };
    
    const newCrop = await createCrop(cropData);
    
    log.info('Gröda skapad', { name: newCrop.name });
    res.status(201).json(newCrop);
  } catch (error) {
    log.error('Error creating crop', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte skapa gröda',
      details: getErrorMessage(error),
    });
  }
});

/**
 * PUT /api/admin/crops/:id
 * Update an existing crop
 */
router.put('/:id', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const cropId = req.params.id;
    
    const cropData = {
      name: req.body.name,
      category: req.body.category,
      unit: req.body.unit,
      n_per_ton: req.body.n_per_ton,
      p_per_ton: req.body.p_per_ton,
      k_per_ton: req.body.k_per_ton,
      s_per_ton: req.body.s_per_ton || null,
      yield_min: req.body.yield_min,
      yield_max: req.body.yield_max,
      yield_average: req.body.yield_average,
      precrop_n_effect: req.body.precrop_n_effect,
      precrop_yield_effect: req.body.precrop_yield_effect,
      description: req.body.description || null,
      source_provider: req.body.source_provider || 'Jordbruksverket',
      source_note: req.body.source_note || null,
    };
    
    const updatedCrop = await updateCrop(cropId, cropData);
    
    log.info('Gröda uppdaterad', { cropId });
    res.json(updatedCrop);
  } catch (error) {
    log.error('Error updating crop', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte uppdatera gröda',
      details: getErrorMessage(error),
    });
  }
});

/**
 * DELETE /api/admin/crops/:id
 * Delete a crop
 */
router.delete('/:id', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const cropId = req.params.id;
    
    await deleteCrop(cropId);
    
    log.info('Gröda borttagen', { cropId });
    res.json({ success: true, message: 'Gröda borttagen' });
  } catch (error) {
    log.error('Error deleting crop', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte ta bort gröda',
      details: getErrorMessage(error),
    });
  }
});

export default router;
