import { Product } from '../models/Product';
import { NutrientNeed } from '../models/NutrientNeed';
import { Solution } from '../models/Solution';
import { Strategy } from './scoring';
import { optimizeV7ToSolutions, AlgorithmConfigV7 } from './optimize-v7';

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
  
  console.log(`📊 Filtrerade ${products.length} produkter → ${relevantProducts.length} relevanta`);
  
  const productsToUse = relevantProducts.length >= 5 ? relevantProducts : products;
  console.log(`🎯 Använder ${productsToUse.length} produkter (maxProducts: ${maxProducts})`);

  // Kör V7 MILP-optimering
  console.log('🚀 Kör OPTIMIZER V7 (HiGHS MILP-solver)');
  const solutions = await optimizeV7ToSolutions(productsToUse, need, {
    maxProducts,
    requiredNutrients: options.requiredNutrients,
    minDose,
    maxDose,
    config: options.algorithmConfig,
  });
  
  console.log(`✅ V7 returnerade: ${solutions.length} lösningar`);
  return solutions.slice(0, topN);
}

