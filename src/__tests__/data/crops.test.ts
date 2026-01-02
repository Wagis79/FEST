/**
 * FEST - Tester för crops.ts
 * 
 * Testar beräkningsfunktioner för näringsbehov:
 * - calculateNutrientNeed
 * - calculateNutrientNeedWithPrecrop
 */

import { describe, it, expect } from 'vitest';
import type { Crop } from '../../data/crops';
import { calculateNutrientNeed, calculateNutrientNeedWithPrecrop } from '../../data/crops';

// ============================================================================
// TEST DATA
// ============================================================================

const testCrops: Record<string, Crop> = {
  hostevete: {
    id: 'hostevete',
    name: 'Höstvete (bröd)',
    category: 'spannmal',
    unit: 'TON_GRAIN',
    nutrientPerTon: { N: 24.3, P: 3.6, K: 4.5, S: 1.5 },
    typicalYield: { min: 5, max: 12, average: 8 },
    precropEffect: { nEffect: 0, yieldEffect: 0 },
    source: { provider: 'Jordbruksverket', note: 'Test data' }
  },
  blandvall: {
    id: 'blandvall',
    name: 'Blandvall',
    category: 'grovfoder',
    unit: 'TON_TS',
    nutrientPerTon: { N: 20, P: 3, K: 20, S: 2 },
    typicalYield: { min: 5, max: 12, average: 8 },
    precropEffect: { nEffect: 40, yieldEffect: 800 }, // 40 kg N efterverkan, 800 kg skördeökning
    source: { provider: 'Jordbruksverket', note: 'Test data' }
  },
  arter: {
    id: 'arter',
    name: 'Ärter',
    category: 'ovriga',
    unit: 'TON_SEED',
    nutrientPerTon: { N: 0, P: 4, K: 12, S: 1 }, // Fixerar sitt eget kväve
    typicalYield: { min: 2, max: 5, average: 3.5 },
    precropEffect: { nEffect: 25, yieldEffect: 500 },
    source: { provider: 'Jordbruksverket', note: 'Test data' }
  },
  utanForfruktsvardet: {
    id: 'test_no_precrop',
    name: 'Test utan förfruktsvärde',
    category: 'spannmal',
    unit: 'TON_GRAIN',
    nutrientPerTon: { N: 20, P: 4, K: 5 }, // Inget S
    typicalYield: { min: 4, max: 10, average: 7 },
    // precropEffect saknas
    source: { provider: 'Jordbruksverket', note: 'Test data' }
  }
};

// ============================================================================
// calculateNutrientNeed
// ============================================================================

describe('calculateNutrientNeed', () => {

  it('ska beräkna näringsbehov baserat på gröda och skörd', () => {
    const result = calculateNutrientNeed(testCrops.hostevete, 8);
    
    expect(result.N).toBe(24.3 * 8);  // 194.4
    expect(result.P).toBe(3.6 * 8);   // 28.8
    expect(result.K).toBe(4.5 * 8);   // 36
    expect(result.S).toBe(1.5 * 8);   // 12
  });

  it('ska returnera 0 vid skörd 0', () => {
    const result = calculateNutrientNeed(testCrops.hostevete, 0);
    
    expect(result.N).toBe(0);
    expect(result.P).toBe(0);
    expect(result.K).toBe(0);
    expect(result.S).toBe(0);
  });

  it('ska hantera gröda utan S-värde', () => {
    const result = calculateNutrientNeed(testCrops.utanForfruktsvardet, 6);
    
    expect(result.N).toBe(20 * 6);  // 120
    expect(result.P).toBe(4 * 6);   // 24
    expect(result.K).toBe(5 * 6);   // 30
    expect(result.S).toBeUndefined();
  });

  it('ska skala linjärt med skörd', () => {
    const low = calculateNutrientNeed(testCrops.hostevete, 4);
    const high = calculateNutrientNeed(testCrops.hostevete, 8);
    
    // Dubbel skörd = dubbelt behov
    expect(high.N).toBe(low.N * 2);
    expect(high.P).toBe(low.P * 2);
    expect(high.K).toBe(low.K * 2);
  });

  it('ska hantera decimalskörd', () => {
    const result = calculateNutrientNeed(testCrops.hostevete, 7.5);
    
    expect(result.N).toBeCloseTo(24.3 * 7.5, 5);
    expect(result.P).toBeCloseTo(3.6 * 7.5, 5);
  });

});

// ============================================================================
// calculateNutrientNeedWithPrecrop
// ============================================================================

describe('calculateNutrientNeedWithPrecrop', () => {

  describe('Utan förfrukt', () => {

    it('ska returnera samma som calculateNutrientNeed utan förfrukt', () => {
      const basic = calculateNutrientNeed(testCrops.hostevete, 8);
      const withPrecrop = calculateNutrientNeedWithPrecrop(testCrops.hostevete, 8);
      
      expect(withPrecrop.N).toBe(basic.N);
      expect(withPrecrop.P).toBe(basic.P);
      expect(withPrecrop.K).toBe(basic.K);
      expect(withPrecrop.precropNEffect).toBe(0);
      expect(withPrecrop.yieldIncreaseKgHa).toBe(0);
      expect(withPrecrop.yieldIncreaseNRequirement).toBe(0);
    });

    it('ska returnera samma med undefined förfrukt', () => {
      const basic = calculateNutrientNeed(testCrops.hostevete, 8);
      const withPrecrop = calculateNutrientNeedWithPrecrop(testCrops.hostevete, 8, undefined);
      
      expect(withPrecrop.N).toBe(basic.N);
    });

  });

  describe('Med förfrukt (blandvall)', () => {

    it('ska minska N-behov pga kväveefterverkan', () => {
      const basic = calculateNutrientNeed(testCrops.hostevete, 8);
      const withPrecrop = calculateNutrientNeedWithPrecrop(testCrops.hostevete, 8, testCrops.blandvall);
      
      // Blandvall ger -40 kg N efterverkan och +800 kg skörd (+12 kg N behov)
      // Netto: -40 + 12 = -28 kg N
      const expectedNAdjustment = -40 + (800 / 1000 * 15);
      const expectedN = basic.N + expectedNAdjustment;
      
      expect(withPrecrop.N).toBeCloseTo(expectedN, 1);
      expect(withPrecrop.N).toBeLessThan(basic.N);
    });

    it('ska returnera korrekt precropNEffect', () => {
      const withPrecrop = calculateNutrientNeedWithPrecrop(testCrops.hostevete, 8, testCrops.blandvall);
      
      expect(withPrecrop.precropNEffect).toBe(40);
    });

    it('ska returnera korrekt yieldIncreaseKgHa', () => {
      const withPrecrop = calculateNutrientNeedWithPrecrop(testCrops.hostevete, 8, testCrops.blandvall);
      
      expect(withPrecrop.yieldIncreaseKgHa).toBe(800);
    });

    it('ska returnera korrekt yieldIncreaseNRequirement', () => {
      const withPrecrop = calculateNutrientNeedWithPrecrop(testCrops.hostevete, 8, testCrops.blandvall);
      
      // 800 kg = 0.8 ton × 15 kg N/ton = 12 kg N
      expect(withPrecrop.yieldIncreaseNRequirement).toBe(12);
    });

    it('ska inte påverka P och K', () => {
      const basic = calculateNutrientNeed(testCrops.hostevete, 8);
      const withPrecrop = calculateNutrientNeedWithPrecrop(testCrops.hostevete, 8, testCrops.blandvall);
      
      expect(withPrecrop.P).toBe(basic.P);
      expect(withPrecrop.K).toBe(basic.K);
    });

  });

  describe('Med förfrukt (ärter)', () => {

    it('ska beräkna korrekt med mindre förfruktseffekt', () => {
      const basic = calculateNutrientNeed(testCrops.hostevete, 8);
      const withPrecrop = calculateNutrientNeedWithPrecrop(testCrops.hostevete, 8, testCrops.arter);
      
      // Ärter: -25 kg N + (500/1000 * 15) = -25 + 7.5 = -17.5 kg N
      expect(withPrecrop.precropNEffect).toBe(25);
      expect(withPrecrop.yieldIncreaseKgHa).toBe(500);
      expect(withPrecrop.yieldIncreaseNRequirement).toBe(7.5);
      
      const expectedN = basic.N - 25 + 7.5;
      expect(withPrecrop.N).toBeCloseTo(expectedN, 1);
    });

  });

  describe('Kantfall', () => {

    it('ska aldrig ge negativt N-behov', () => {
      // Skapa en gröda med mycket lågt N-behov
      const lowNCrop: Crop = {
        ...testCrops.hostevete,
        nutrientPerTon: { N: 5, P: 3, K: 4, S: 1 }
      };
      
      // Med blandvall som förfrukt (40 kg N efterverkan)
      const result = calculateNutrientNeedWithPrecrop(lowNCrop, 2, testCrops.blandvall);
      
      // Basbehov: 5 * 2 = 10 kg N
      // Justering: +12 - 40 = -28
      // Resultat: 10 - 28 = -18 → ska bli 0
      expect(result.N).toBeGreaterThanOrEqual(0);
    });

    it('ska hantera förfrukt utan precropEffect', () => {
      const result = calculateNutrientNeedWithPrecrop(
        testCrops.hostevete, 
        8, 
        testCrops.utanForfruktsvardet
      );
      
      // Ingen förfruktseffekt
      expect(result.precropNEffect).toBe(0);
      expect(result.yieldIncreaseKgHa).toBe(0);
    });

    it('ska avrunda N-behov till 1 decimal', () => {
      const result = calculateNutrientNeedWithPrecrop(testCrops.hostevete, 8, testCrops.blandvall);
      
      // Kontrollera att N har max 1 decimal
      const decimalPart = result.N - Math.floor(result.N);
      expect(decimalPart * 10 % 1).toBeCloseTo(0, 5);
    });

  });

  describe('Dokumenterat exempel: Fodervete efter blandvall', () => {

    it('ska matcha exemplet i dokumentationen', () => {
      // Skapa fodervete-gröda
      const fodervete: Crop = {
        id: 'fodervete',
        name: 'Fodervete',
        category: 'spannmal',
        unit: 'TON_GRAIN',
        nutrientPerTon: { N: 16.86, P: 3.2, K: 4.0 }, // ~101 kg N vid 6 ton
        typicalYield: { min: 4, max: 10, average: 6 },
        source: { provider: 'Jordbruksverket', note: 'Test' }
      };
      
      const result = calculateNutrientNeedWithPrecrop(fodervete, 6, testCrops.blandvall);
      
      // Basbehov: 16.86 * 6 = 101.16 kg N
      // Skördeökning: 800 kg = 0.8 ton × 15 = 12 kg N
      // Kväveefterverkan: -40 kg N
      // Slutbehov: 101.16 + 12 - 40 = 73.16 kg N
      
      expect(result.N).toBeCloseTo(73.16, 0); // Avrundningsfel accepteras
      expect(result.yieldIncreaseNRequirement).toBe(12);
      expect(result.precropNEffect).toBe(40);
    });

  });

});
