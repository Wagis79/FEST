/**
 * FEST - Admin Product Analysis Routes
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import log from '../../utils/logger';
import { getAllProductsForRecommendation } from '../supabase';
import { requireAdminPassword } from '../middleware';

const router = Router();

/** Helper to extract error message from unknown error */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * GET /api/admin/product-analysis
 * Analyze product pricing and nutrient costs
 */
router.get('/', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const products = await getAllProductsForRecommendation();

    interface ProductAnalysis {
      id: string;
      name: string;
      pricePerKg: number;
      nutrients: {
        N?: number;
        P?: number;
        K?: number;
        S?: number;
      };
      costPerNutrient: {
        N?: number | null;
        P?: number | null;
        K?: number | null;
        S?: number | null;
      };
      usableNutrients: string[];
    }

    const analysis: ProductAnalysis[] = products.map(product => {
      const costPerNutrient: ProductAnalysis['costPerNutrient'] = {};
      const usableNutrients: string[] = [];

      if (product.nutrients.N && product.nutrients.N > 0) {
        costPerNutrient.N = product.pricePerKg / (product.nutrients.N / 100);
        usableNutrients.push('N');
      } else {
        costPerNutrient.N = null;
      }

      if (product.nutrients.P && product.nutrients.P > 0) {
        costPerNutrient.P = product.pricePerKg / (product.nutrients.P / 100);
        usableNutrients.push('P');
      } else {
        costPerNutrient.P = null;
      }

      if (product.nutrients.K && product.nutrients.K > 0) {
        costPerNutrient.K = product.pricePerKg / (product.nutrients.K / 100);
        usableNutrients.push('K');
      } else {
        costPerNutrient.K = null;
      }

      if (product.nutrients.S && product.nutrients.S > 0) {
        costPerNutrient.S = product.pricePerKg / (product.nutrients.S / 100);
        usableNutrients.push('S');
      } else {
        costPerNutrient.S = null;
      }

      return {
        id: product.id,
        name: product.name,
        pricePerKg: product.pricePerKg,
        nutrients: product.nutrients,
        costPerNutrient,
        usableNutrients
      };
    });

    const cheapestSources = {
      N: analysis.filter(p => p.costPerNutrient.N !== null).sort((a, b) => (a.costPerNutrient.N || 999999) - (b.costPerNutrient.N || 999999)).slice(0, 5),
      P: analysis.filter(p => p.costPerNutrient.P !== null).sort((a, b) => (a.costPerNutrient.P || 999999) - (b.costPerNutrient.P || 999999)).slice(0, 5),
      K: analysis.filter(p => p.costPerNutrient.K !== null).sort((a, b) => (a.costPerNutrient.K || 999999) - (b.costPerNutrient.K || 999999)).slice(0, 5),
      S: analysis.filter(p => p.costPerNutrient.S !== null).sort((a, b) => (a.costPerNutrient.S || 999999) - (b.costPerNutrient.S || 999999)).slice(0, 5)
    };

    res.json({
      success: true,
      totalProducts: products.length,
      analysis,
      cheapestSources,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    log.error('Product analysis error', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze products',
      details: getErrorMessage(error),
    });
  }
});

export default router;
