/**
 * FEST - Public API Routes
 * Endpoints for products, crops, recommendations, and health checks
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import log from '../../utils/logger';
import { calculateNutrientNeed, calculateNutrientNeedWithPrecrop } from '../../data/crops';
import type { RecommendOptions } from '../../engine/recommend';
import { recommend } from '../../engine/recommend';
import type { OptimizeV7Input } from '../../engine/optimize-v7';
import { optimizeV7 } from '../../engine/optimize-v7';
import type { NutrientNeed } from '../../models/NutrientNeed';
import { 
  validateBody,
  RecommendRequestSchema,
  OptimizeV7APIRequestSchema,
  generateInputWarnings,
  type RecommendRequest,
  type OptimizeV7APIRequest,
} from '../validation';
import { 
  getAllProductsForRecommendation,
  getProductsForRecommendation,
  getAllCrops,
  getCropById,
  getCropsByCategory,
  getAlgorithmConfigMap,
} from '../supabase';
import { requireApiKey, blockExternalAccess, optimizeLimiter } from '../middleware';

const router = Router();

/**
 * GET /api/products
 * Returnera alla produkter tillgängliga för optimering
 */
router.get('/products', requireApiKey, async (req: Request, res: Response) => {
  try {
    const products = await getAllProductsForRecommendation();
    res.json({
      success: true,
      count: products.length,
      products: products,
    });
  } catch (error) {
    log.error('Error fetching products', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte hämta produkter',
    });
  }
});

/**
 * POST /api/recommend
 * Få rekommendationer baserat på näringsbehov
 */
router.post('/recommend', requireApiKey, optimizeLimiter, validateBody(RecommendRequestSchema), async (req: Request, res: Response) => {
  try {
    const validatedData = req.body as RecommendRequest;
    const { need, strategy, maxProducts, topN, requiredNutrients, excludedProductIds, requiredProductIds } = validatedData;

    log.request('POST', '/api/recommend', { 
      need, 
      strategy, 
      maxProducts, 
      topN, 
      requiredNutrients,
      excludedCount: excludedProductIds?.length || 0,
      requiredCount: requiredProductIds?.length || 0
    });

    // Generera varningar baserat på input
    const warnings = generateInputWarnings(validatedData);
    if (warnings.length > 0) {
      log.warn('Valideringsvarningar', { warnings });
    }

    // Hämta produkter från Supabase
    let products = await getProductsForRecommendation(need as NutrientNeed, strategy);
  
    // Se till att tvingade produkter alltid är med i urvalet
    if (requiredProductIds && Array.isArray(requiredProductIds) && requiredProductIds.length > 0) {
      const productIdSet = new Set(products.map(p => p.id));
      const missingRequired = requiredProductIds.filter(id => !productIdSet.has(id));
      
      if (missingRequired.length > 0) {
        const allProducts = await getAllProductsForRecommendation();
        const missingProducts = allProducts.filter(p => missingRequired.includes(p.id));
        products = [...products, ...missingProducts];
        log.debug('Lade till tvingade produkter som saknades i urvalet', { 
          added: missingProducts.length, 
          requested: missingRequired.length 
        });
      }
    }
      
    // Filtrera bort användarexkluderade produkter
    if (excludedProductIds && Array.isArray(excludedProductIds) && excludedProductIds.length > 0) {
      const excludedSet = new Set(excludedProductIds);
      const originalCount = products.length;
      products = products.filter(p => !excludedSet.has(p.id));
      log.debug('Produkter exkluderade', { excluded: originalCount - products.length, requested: excludedProductIds.length });
    }
      
    if (products.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Inga produkter tillgängliga för beräkning',
      });
    }

    // Hämta algoritmkonfiguration
    let algorithmConfig;
    try {
      algorithmConfig = await getAlgorithmConfigMap();
      log.debug('Algoritmkonfiguration laddad för /recommend');
    } catch (configErr) {
      log.warn('Kunde inte ladda algoritmkonfiguration, använder defaults', { error: configErr });
    }

    const options: RecommendOptions = {
      strategy,
      maxProducts: maxProducts as 1 | 2 | 3 | 4 | 5,
      topN,
      requiredNutrients: requiredNutrients || undefined,
      algorithmConfig,
      requiredProductIds: requiredProductIds || undefined,
    };

    const solutions = await recommend(need as NutrientNeed, products, options);

    const response: Record<string, unknown> = {
      success: true,
      count: solutions.length,
      need,
      strategy,
      requiredNutrients: requiredNutrients || [],
      requiredProductIds: requiredProductIds || [],
      solutions,
    };
    
    if (warnings.length > 0) {
      response.warnings = warnings;
    }
    
    response.limits = {
      maxProducts: { min: 1, max: 5, recommended: 3 },
      requiredProductIds: { max: maxProducts, recommended: Math.max(1, maxProducts - 1) },
      totalNeed: { min: 20, max: 600, unit: 'kg/ha' },
      nitrogen: { max: 400, unit: 'kg/ha' }
    };

    res.json(response);
  } catch (error) {
    log.error('Error in /api/recommend', error);
    res.status(500).json({
      success: false,
      error: 'Serverfel vid beräkning av rekommendationer',
    });
  }
});

/**
 * POST /api/optimize-v7
 * MILP-baserad ILP-optimering (endast intern)
 */
router.post('/optimize-v7', blockExternalAccess, optimizeLimiter, validateBody(OptimizeV7APIRequestSchema), async (req: Request, res: Response) => {
  try {
    const validatedData = req.body as OptimizeV7APIRequest;
    const { targets, mustFlags, maxProducts, minDose, maxDose } = validatedData;

    log.request('POST', '/api/optimize-v7', { targets, mustFlags, maxProducts, minDose, maxDose });

    const products = await getAllProductsForRecommendation();
    
    if (products.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Inga produkter tillgängliga för optimering',
      });
    }

    log.optimize(`V7-optimering med ${products.length} produkter`);

    const input: OptimizeV7Input = {
      targets: {
        N: targets.N || 0,
        P: targets.P || 0,
        K: targets.K || 0,
        S: targets.S || 0,
      },
      mustFlags: {
        mustN: mustFlags.mustN || false,
        mustP: mustFlags.mustP || false,
        mustK: mustFlags.mustK || false,
        mustS: mustFlags.mustS || false,
      },
      maxProductsUser: maxProducts,
      minDoseKgHa: minDose,
      maxDoseKgHa: maxDose,
    };

    try {
      const algorithmConfig = await getAlgorithmConfigMap();
      input.config = algorithmConfig;
      log.debug('Algoritmkonfiguration laddad för /optimize-v7');
    } catch (configErr) {
      log.warn('Kunde inte ladda algoritmkonfiguration, använder defaults', { error: configErr });
    }

    const result = await optimizeV7(products, input);

    log.optimize(`V7 klar: ${result.strategies.length} strategier`, { status: result.status });

    res.json({
      success: result.status === 'ok',
      ...result,
    });
  } catch (error) {
    log.error('Error in /api/optimize-v7', error);
    res.status(500).json({
      success: false,
      status: 'error',
      error: 'Serverfel vid V7-optimering',
      message: error instanceof Error ? error.message : 'Okänt fel',
    });
  }
});

/**
 * GET /api/crops
 * Returnera alla tillgängliga grödor
 */
router.get('/crops', requireApiKey, async (req: Request, res: Response) => {
  try {
    const category = req.query.category as string | undefined;
    const validCategories = ['spannmal', 'oljevaxte', 'rotfrukter', 'grovfoder', 'ovriga'] as const;
    type CropCategory = typeof validCategories[number];
    
    let crops;
    if (category && validCategories.includes(category as CropCategory)) {
      crops = await getCropsByCategory(category as CropCategory);
    } else {
      crops = await getAllCrops();
    }
    
    if (crops.length === 0) {
      log.error('Inga grödor hittades i databasen');
      return res.status(503).json({
        success: false,
        error: 'Kunde inte hämta grödor från databasen',
      });
    }
    
    res.json({
      success: true,
      count: crops.length,
      crops: crops,
    });
  } catch (error) {
    log.error('Error fetching crops', error);
    res.status(500).json({
      success: false,
      error: 'Serverfel vid hämtning av grödor',
    });
  }
});

/**
 * POST /api/calculate-need
 * Beräkna näringsbehov från gröda och skörd
 */
router.post('/calculate-need', requireApiKey, async (req: Request, res: Response) => {
  try {
    const { cropId, yieldTonPerHa, precropId } = req.body;

    if (!cropId || !yieldTonPerHa) {
      return res.status(400).json({
        success: false,
        error: 'cropId och yieldTonPerHa krävs',
      });
    }

    const crop = await getCropById(cropId);
    if (!crop) {
      return res.status(404).json({
        success: false,
        error: `Gröda med id '${cropId}' hittades inte`,
      });
    }

    const precrop = precropId ? await getCropById(precropId) : null;
    
    let need;
    let precropNEffect = 0;
    let yieldIncreaseKgHa = 0;
    let yieldIncreaseNRequirement = 0;
    
    if (precrop) {
      const result = calculateNutrientNeedWithPrecrop(crop, yieldTonPerHa, precrop);
      need = { N: result.N, P: result.P, K: result.K, S: result.S };
      precropNEffect = result.precropNEffect;
      yieldIncreaseKgHa = result.yieldIncreaseKgHa;
      yieldIncreaseNRequirement = result.yieldIncreaseNRequirement;
    } else {
      need = calculateNutrientNeed(crop, yieldTonPerHa);
    }

    res.json({
      success: true,
      crop: crop.name,
      yieldTonPerHa,
      need,
      precrop: precrop ? {
        id: precrop.id,
        name: precrop.name,
        nEffect: precropNEffect,
        yieldIncreaseKgHa,
        yieldIncreaseNRequirement,
      } : null,
    });
  } catch (error) {
    log.error('Error in /api/calculate-need', error);
    res.status(500).json({
      success: false,
      error: 'Serverfel vid beräkning av näringsbehov',
    });
  }
});

export default router;
