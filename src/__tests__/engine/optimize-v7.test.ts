/**
 * FEST - Tester för gödseloptimering v7
 * 
 * Testar kärnlogik i optimeringsmotorn:
 * - Multi-nutrient optimering
 * - Single nutrient mode
 * - N-tolerans eskalering
 * - Prispall (no-good cuts)
 * - Varningar för höga nivåer
 */

import { describe, it, expect } from 'vitest';
import type {
  OptimizeV7Input} from '../../engine/optimize-v7';
import { 
  optimizeV7, 
  optimizeV7ToSolutions,
  DEFAULT_ALGORITHM_CONFIG_V7 
} from '../../engine/optimize-v7';
import type { Product } from '../../models/Product';

// ============================================================================
// TESTPRODUKTER
// ============================================================================

const testProducts: Product[] = [
  {
    id: 'test-npk-1',
    name: 'NPK 21-4-7',
    pricePerKg: 4.50,
    nutrients: { N: 21, P: 4, K: 7, S: 3 }
  },
  {
    id: 'test-npk-2',
    name: 'NPK 27-3-3',
    pricePerKg: 4.00,
    nutrients: { N: 27, P: 3, K: 3, S: 2 }
  },
  {
    id: 'test-n',
    name: 'Kalkammonsalpeter 27N',
    pricePerKg: 3.50,
    nutrients: { N: 27, P: 0, K: 0, S: 0 }
  },
  {
    id: 'test-pk',
    name: 'PK 11-21',
    pricePerKg: 5.00,
    nutrients: { N: 0, P: 11, K: 21, S: 0 }
  },
  {
    id: 'test-s',
    name: 'Svavelsur ammoniak',
    pricePerKg: 3.00,
    nutrients: { N: 21, P: 0, K: 0, S: 24 }
  }
];

// ============================================================================
// BASIC FUNCTIONALITY TESTS
// ============================================================================

describe('optimizeV7', () => {
  
  describe('Grundläggande funktionalitet', () => {
    
    it('ska returnera lösning för giltigt multi-nutrient behov', async () => {
      const input: OptimizeV7Input = {
        targets: { N: 150, P: 20, K: 30, S: 10 },
        mustFlags: { mustN: true, mustP: true, mustK: true, mustS: true },
        maxProductsUser: 3,
        minDoseKgHa: 100,
        maxDoseKgHa: 600
      };
      
      const result = await optimizeV7(testProducts, input);
      
      expect(result.status).toBe('ok');
      expect(result.strategies.length).toBeGreaterThan(0);
      expect(result.strategies[0].products.length).toBeLessThanOrEqual(3);
    });

    it('ska respektera maxProductsUser', async () => {
      const input: OptimizeV7Input = {
        targets: { N: 150, P: 20, K: 30, S: 10 },
        mustFlags: { mustN: true, mustP: true, mustK: true, mustS: true },
        maxProductsUser: 2,
        minDoseKgHa: 100,
        maxDoseKgHa: 600
      };
      
      const result = await optimizeV7(testProducts, input);
      
      if (result.status === 'ok') {
        result.strategies.forEach(strategy => {
          expect(strategy.products.length).toBeLessThanOrEqual(2);
        });
      }
    });

    it('ska returnera flera strategier (prispall)', async () => {
      const input: OptimizeV7Input = {
        targets: { N: 120, P: 15, K: 25 },
        mustFlags: { mustN: true, mustP: true, mustK: true, mustS: false },
        maxProductsUser: 3,
        minDoseKgHa: 100,
        maxDoseKgHa: 600,
        config: { NUM_STRATEGIES: 3 }
      };
      
      const result = await optimizeV7(testProducts, input);
      
      expect(result.status).toBe('ok');
      // Beroende på produktkombinationer kan vi få 1-3 strategier
      expect(result.strategies.length).toBeGreaterThanOrEqual(1);
    });

  });

  // ============================================================================
  // NUTRIENT CONSTRAINTS
  // ============================================================================

  describe('Näringsconstraints', () => {
    
    it('ska uppfylla N-krav inom tolerans', async () => {
      const input: OptimizeV7Input = {
        targets: { N: 150 },
        mustFlags: { mustN: true, mustP: false, mustK: false, mustS: false },
        maxProductsUser: 2,
        minDoseKgHa: 100,
        maxDoseKgHa: 600
      };
      
      const result = await optimizeV7(testProducts, input);
      
      expect(result.status).toBe('ok');
      const achieved = result.strategies[0].achieved.N;
      const tolerance = result.nToleranceUsed || DEFAULT_ALGORITHM_CONFIG_V7.N_TOLERANCE_KG;
      
      // N ska vara >= target och <= target + tolerans
      expect(achieved).toBeGreaterThanOrEqual(150);
      expect(achieved).toBeLessThanOrEqual(150 + tolerance);
    });

    it('ska uppfylla PKS-krav inom 85-125% av mål', async () => {
      const input: OptimizeV7Input = {
        targets: { N: 100, P: 20, K: 30 },
        mustFlags: { mustN: true, mustP: true, mustK: true, mustS: false },
        maxProductsUser: 3,
        minDoseKgHa: 100,
        maxDoseKgHa: 600,
        config: { PKS_MIN_PCT: 85, PKS_MAX_PCT: 125 }
      };
      
      const result = await optimizeV7(testProducts, input);
      
      if (result.status === 'ok') {
        const strategy = result.strategies[0];
        
        // P ska vara 85-125% av target
        const pPct = strategy.percentOfTarget.P;
        if (pPct !== null) {
          expect(pPct).toBeGreaterThanOrEqual(85);
          expect(pPct).toBeLessThanOrEqual(125);
        }
        
        // K ska vara 85-125% av target
        const kPct = strategy.percentOfTarget.K;
        if (kPct !== null) {
          expect(kPct).toBeGreaterThanOrEqual(85);
          expect(kPct).toBeLessThanOrEqual(125);
        }
      }
    });

  });

  // ============================================================================
  // SINGLE NUTRIENT MODE
  // ============================================================================

  describe('Single Nutrient Mode', () => {
    
    it('ska returnera enskild produkt för N-only behov', async () => {
      const input: OptimizeV7Input = {
        targets: { N: 100 },
        mustFlags: { mustN: true, mustP: false, mustK: false, mustS: false },
        maxProductsUser: 3,
        minDoseKgHa: 100,
        maxDoseKgHa: 600
      };
      
      const result = await optimizeV7(testProducts, input);
      
      expect(result.status).toBe('ok');
      // I single nutrient mode returneras enskilda produkter
      expect(result.strategies[0].products.length).toBe(1);
    });

    it('ska ranka produkter på kostnad i single nutrient mode', async () => {
      const input: OptimizeV7Input = {
        targets: { N: 100 },
        mustFlags: { mustN: true, mustP: false, mustK: false, mustS: false },
        maxProductsUser: 3,
        minDoseKgHa: 100,
        maxDoseKgHa: 600
      };
      
      const result = await optimizeV7(testProducts, input);
      
      expect(result.status).toBe('ok');
      
      // Strategierna ska vara rankade på kostnad (lägst först)
      for (let i = 1; i < result.strategies.length; i++) {
        expect(result.strategies[i].totalCostSekHa)
          .toBeGreaterThanOrEqual(result.strategies[i-1].totalCostSekHa);
      }
    });

  });

  // ============================================================================
  // WARNINGS
  // ============================================================================

  describe('Varningar', () => {
    
    it('ska ge varning när okryssat ämne överstiger 150%', async () => {
      // Kryssa bara N, men produkten ger mycket P också
      const singleProduct: Product[] = [{
        id: 'high-p',
        name: 'High P Product',
        pricePerKg: 3.00,
        nutrients: { N: 20, P: 20, K: 0, S: 0 }
      }];
      
      const input: OptimizeV7Input = {
        targets: { N: 100, P: 10 }, // P-behov är lågt
        mustFlags: { mustN: true, mustP: false, mustK: false, mustS: false },
        maxProductsUser: 1,
        minDoseKgHa: 100,
        maxDoseKgHa: 600,
        config: { HIGH_LEVEL_THRESHOLD: 150 }
      };
      
      const result = await optimizeV7(singleProduct, input);
      
      if (result.status === 'ok') {
        const warnings = result.strategies[0].warnings;
        const pWarning = warnings.find(w => w.nutrient === 'P');
        
        // Om P överstiger 150% av behov borde vi få varning
        const pAchieved = result.strategies[0].achieved.P;
        if (pAchieved > 10 * 1.5) {
          expect(pWarning).toBeDefined();
          expect(pWarning?.type).toBe('HIGH_LEVEL');
        }
      }
    });

  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Kantfall', () => {
    
    it('ska hantera tomt produktutbud', async () => {
      const input: OptimizeV7Input = {
        targets: { N: 100 },
        mustFlags: { mustN: true, mustP: false, mustK: false, mustS: false },
        maxProductsUser: 3,
        minDoseKgHa: 100,
        maxDoseKgHa: 600
      };
      
      const result = await optimizeV7([], input);
      
      expect(result.status).toBe('infeasible');
    });

    it('ska hantera orealistiskt höga krav', async () => {
      const input: OptimizeV7Input = {
        targets: { N: 10000, P: 5000, K: 5000, S: 5000 },
        mustFlags: { mustN: true, mustP: true, mustK: true, mustS: true },
        maxProductsUser: 3,
        minDoseKgHa: 100,
        maxDoseKgHa: 600
      };
      
      const result = await optimizeV7(testProducts, input);
      
      // Kan vara infeasible eller ok med eskalerad tolerans
      expect(['ok', 'infeasible']).toContain(result.status);
    });

    it('ska hantera minDose > maxDose', async () => {
      const input: OptimizeV7Input = {
        targets: { N: 100 },
        mustFlags: { mustN: true, mustP: false, mustK: false, mustS: false },
        maxProductsUser: 2,
        minDoseKgHa: 600, // Inverterade värden
        maxDoseKgHa: 100
      };
      
      const result = await optimizeV7(testProducts, input);
      
      // Ska antingen ge infeasible eller korrigera internt
      expect(['ok', 'infeasible']).toContain(result.status);
    });

  });

});

// ============================================================================
// optimizeV7ToSolutions TESTS
// ============================================================================

describe('optimizeV7ToSolutions', () => {
  
  it('ska konvertera till Solution-format', async () => {
    const need = { N: 120, P: 15, K: 25, S: 8 };
    
    const solutions = await optimizeV7ToSolutions(
      testProducts,
      need,
      {
        maxProducts: 3,
        requiredNutrients: ['N', 'P', 'K', 'S']
      }
    );
    
    expect(Array.isArray(solutions)).toBe(true);
    
    if (solutions.length > 0) {
      const first = solutions[0];
      expect(first).toHaveProperty('products');
      expect(first).toHaveProperty('supplied');
      expect(first).toHaveProperty('costPerHa');
      expect(first).toHaveProperty('deviation');
    }
  });

});
