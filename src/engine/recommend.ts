/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 */

import type { Product } from '../models/Product';
import type { NutrientNeed } from '../models/NutrientNeed';
import type { Solution } from '../models/Solution';
import type { Strategy } from './scoring';
import type { AlgorithmConfigV7 } from './optimize-v7';
import { optimizeV7ToSolutions } from './optimize-v7';
import log from '../utils/logger';

/**
 * Options för rekommendationsmotor
 */
export interface RecommendOptions {
  /** Max antal produkter i en lösning (1-5) */
  maxProducts?: 1 | 2 | 3 | 4 | 5;
  
  /** Antal lösningar att returnera */
  topN?: number;
  
  /** Strategi: economic (billigast) eller optimized (precision) */
  strategy?: Strategy;
  
  /** Valfritt: näringsämnen som MÅSTE inkluderas */
  requiredNutrients?: Array<'N' | 'P' | 'K' | 'S'>;
  
  /** Min dos per produkt (default 100 kg/ha) */
  minDose?: number;
  
  /** Max dos per produkt (default 600 kg/ha) */
  maxDose?: number;
  
  /** Algoritm-konfiguration från databas */
  algorithmConfig?: AlgorithmConfigV7;
  
  /** Produkt-IDs som MÅSTE inkluderas i lösningen */
  requiredProductIds?: string[];
}

const DEFAULT_OPTIONS = {
  maxProducts: 3 as 1 | 2 | 3 | 4 | 5,
  topN: 10,
  strategy: 'economic' as Strategy,
  minDose: 100,
  maxDose: 600,
};

/**
 * Huvudfunktion: rekommendera gödselprodukter
 * 
 * Använder V7 HiGHS MILP-solver för optimal gödselrekommendation.
 */
export async function recommend(
  need: NutrientNeed,
  products: Product[],
  options: RecommendOptions = {}
): Promise<Solution[]> {
  const maxProducts = options.maxProducts || DEFAULT_OPTIONS.maxProducts;
  const topN = options.topN || DEFAULT_OPTIONS.topN;
  const minDose = options.minDose || DEFAULT_OPTIONS.minDose;
  const maxDose = options.maxDose || DEFAULT_OPTIONS.maxDose;

  // Filtrera relevanta produkter
  const relevantProducts = products.filter(p => {
    const hasRelevant = (p.nutrients.N || 0) > 0 || 
                        (p.nutrients.P || 0) > 0 || 
                        (p.nutrients.K || 0) > 0 || 
                        (p.nutrients.S || 0) > 0;
    return hasRelevant;
  });
  
  log.debug(`Filtrerade ${products.length} produkter → ${relevantProducts.length} relevanta`);
  
  const productsToUse = relevantProducts.length >= 5 ? relevantProducts : products;
  log.debug(`Använder ${productsToUse.length} produkter (maxProducts: ${maxProducts})`);

  // Kör V7 MILP-optimering
  log.optimize('Kör OPTIMIZER V7 (HiGHS MILP-solver)');
  const solutions = await optimizeV7ToSolutions(productsToUse, need, {
    maxProducts,
    requiredNutrients: options.requiredNutrients,
    minDose,
    maxDose,
    config: options.algorithmConfig,
    requiredProductIds: options.requiredProductIds,
  });
  
  log.optimize(`V7 returnerade: ${solutions.length} lösningar`);
  return solutions.slice(0, topN);
}

