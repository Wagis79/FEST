/**
 * FEST - Supabase Data Layer Tests
 * 
 * Testar transformeringsfunktioner och datahantering.
 * Mockar Supabase-klienten för isolerade tester.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Supabase innan vi importerar modulen
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          neq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve({ data: [], error: null }))
            }))
          }))
        })),
        order: vi.fn(() => Promise.resolve({ data: [], error: null }))
      }))
    }))
  }))
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    db: vi.fn(),
    startup: vi.fn(),
    api: vi.fn(),
    engine: vi.fn(),
    debug: vi.fn(),
  }
}));

import {
  dbProductToProduct,
  dbProductToAdminProduct,
  productToDBProduct,
  dbCropToCrop,
  type DBProduct,
  type DBCrop,
  type AdminProduct,
} from '../../api/supabase';

// ============================================================================
// DB PRODUCT TO PRODUCT TRANSFORMATION
// ============================================================================

describe('dbProductToProduct', () => {
  const mockDBProduct: DBProduct = {
    idx: 1,
    Artikelnr: 12345,
    Produkt: 'Test Gödsel',
    N: '15',
    P: '5',
    K: '10',
    S: '3',
    Ca: '2',
    Mg: '1',
    B: '-',
    Cu: '-',
    Mn: '-',
    Zn: '-',
    Pris: '12,50',
    Produktklass: 'Mineral',
    Övrigt: 'Test produkt',
    Enhet: 'KG',
    Optimeringsbar: 'Ja',
    active: true,
  };

  it('ska transformera DBProduct till Product-format', () => {
    const result = dbProductToProduct(mockDBProduct);
    
    expect(result).toEqual({
      id: 'prod-12345',
      name: 'Test Gödsel',
      pricePerKg: 12.5,
      nutrients: {
        N: 15,
        P: 5,
        K: 10,
        S: 3,
      },
      description: 'Mineral - Test produkt',
      isOptimizable: true,
      active: true,
    });
  });

  it('ska hantera produkter med streck (-) som näringsvärden', () => {
    const productWithDashes: DBProduct = {
      ...mockDBProduct,
      N: '-',
      P: '-',
      K: '-',
      S: '-',
    };
    
    const result = dbProductToProduct(productWithDashes);
    
    expect(result.nutrients).toEqual({
      N: 0,
      P: 0,
      K: 0,
      S: 0,
    });
  });

  it('ska sätta active till true om undefined', () => {
    const productNoActive: DBProduct = {
      ...mockDBProduct,
      active: undefined,
    };
    
    const result = dbProductToProduct(productNoActive);
    
    expect(result.active).toBe(true);
  });

  it('ska sätta isOptimizable till false om Optimeringsbar är "Nej"', () => {
    const nonOptimizable: DBProduct = {
      ...mockDBProduct,
      Optimeringsbar: 'Nej',
    };
    
    const result = dbProductToProduct(nonOptimizable);
    
    expect(result.isOptimizable).toBe(false);
  });

  it('ska hantera pris med punkt istället för komma', () => {
    const productWithDotPrice: DBProduct = {
      ...mockDBProduct,
      Pris: '15.75',
    };
    
    const result = dbProductToProduct(productWithDotPrice);
    
    expect(result.pricePerKg).toBe(15.75);
  });
});

// ============================================================================
// DB PRODUCT TO ADMIN PRODUCT TRANSFORMATION
// ============================================================================

describe('dbProductToAdminProduct', () => {
  const mockDBProduct: DBProduct = {
    idx: 1,
    Artikelnr: 99999,
    Produkt: 'Admin Test',
    N: '20',
    P: '10',
    K: '15',
    S: '5',
    Ca: '3',
    Mg: '2',
    B: '0.5',
    Cu: '0.1',
    Mn: '0.2',
    Zn: '0.3',
    Pris: '25,00',
    Produktklass: 'Organisk',
    Övrigt: 'Fullständig produkt',
    Enhet: 'L',
    Optimeringsbar: 'Ja',
    active: true,
  };

  it('ska transformera DBProduct till AdminProduct-format med alla fält', () => {
    const result = dbProductToAdminProduct(mockDBProduct);
    
    expect(result.id).toBe('prod-99999');
    expect(result.name).toBe('Admin Test');
    expect(result.pricePerKg).toBe(25);
    expect(result.N).toBe(20);
    expect(result.P).toBe(10);
    expect(result.K).toBe(15);
    expect(result.S).toBe(5);
    expect(result.Ca).toBe(3);
    expect(result.Mg).toBe(2);
    expect(result.B).toBe(0.5);
    expect(result.Cu).toBe(0.1);
    expect(result.Mn).toBe(0.2);
    expect(result.Zn).toBe(0.3);
    expect(result.productType).toBe('Organisk');
    expect(result.notes).toBe('Fullständig produkt');
    expect(result.unit).toBe('L');
    expect(result.optimizable).toBe(true);
    expect(result.active).toBe(true);
  });

  it('ska hantera produkter utan optional fält', () => {
    const minimalProduct: DBProduct = {
      Artikelnr: 11111,
      Produkt: 'Minimal',
      N: '10',
      P: '5',
      K: '5',
      S: '-',
      Ca: '-',
      Mg: '-',
      B: '-',
      Cu: '-',
      Mn: '-',
      Zn: '-',
      Pris: '10,00',
      Produktklass: undefined,
      Övrigt: undefined,
      Enhet: undefined,
      Optimeringsbar: 'Nej',
    };
    
    const result = dbProductToAdminProduct(minimalProduct);
    
    expect(result.productType).toBe('mineral');
    expect(result.notes).toBe('');
    expect(result.unit).toBe('KG');
    expect(result.optimizable).toBe(false);
    expect(result.active).toBe(true);
  });
});

// ============================================================================
// PRODUCT TO DB PRODUCT TRANSFORMATION
// ============================================================================

describe('productToDBProduct', () => {
  const mockAdminProduct: AdminProduct = {
    id: 'prod-55555',
    name: 'Omvänd Test',
    pricePerKg: 18.5,
    N: 12,
    P: 6,
    K: 8,
    S: 4,
    Ca: 1,
    Mg: 0.5,
    B: 0,
    Cu: 0,
    Mn: 0,
    Zn: 0,
    manufacturer: 'Test AB',
    productType: 'mineral',
    notes: 'Test anteckning',
    unit: 'KG',
    optimizable: true,
    active: true,
  };

  it('ska transformera AdminProduct till DBProduct-format', () => {
    const result = productToDBProduct(mockAdminProduct);
    
    expect(result.Artikelnr).toBe(55555);
    expect(result.Produkt).toBe('Omvänd Test');
    expect(result.N).toBe('12');
    expect(result.P).toBe('6');
    expect(result.K).toBe('8');
    expect(result.S).toBe('4');
    expect(result.Ca).toBe('1');
    expect(result.Mg).toBe('0.5');
    expect(result.B).toBe('-');
    expect(result.Cu).toBe('-');
    expect(result.Mn).toBe('-');
    expect(result.Zn).toBe('-');
    expect(result.Övrigt).toBe('Test anteckning');
    expect(result.Enhet).toBe('KG');
  });

  it('ska formatera 0-värden som streck', () => {
    const productWithZeros: AdminProduct = {
      ...mockAdminProduct,
      N: 0,
      P: 0,
      K: 0,
      S: 0,
    };
    
    const result = productToDBProduct(productWithZeros);
    
    expect(result.N).toBe('-');
    expect(result.P).toBe('-');
    expect(result.K).toBe('-');
    expect(result.S).toBe('-');
  });

  it('ska hantera tom notes', () => {
    const productNoNotes: AdminProduct = {
      ...mockAdminProduct,
      notes: '',
    };
    
    const result = productToDBProduct(productNoNotes);
    
    expect(result.Övrigt).toBe('-');
  });
});

// ============================================================================
// DB CROP TO CROP TRANSFORMATION
// ============================================================================

describe('dbCropToCrop', () => {
  const mockDBCrop: DBCrop = {
    id: 'crop-001',
    name: 'Höstvete',
    category: 'spannmål',
    unit: 'ton',
    n_per_ton: 22,
    p_per_ton: 4,
    k_per_ton: 5,
    s_per_ton: 2,
    yield_min: 4,
    yield_max: 10,
    yield_average: 7,
    precrop_n_effect: 0,
    precrop_yield_effect: 0,
    description: 'Vanligt höstvete',
    source_provider: 'Jordbruksverket',
    source_note: 'Rekommendationer 2024',
    source_url: 'https://example.com',
    created_at: '2024-01-01',
    updated_at: '2024-01-15',
  };

  it('ska transformera DBCrop till Crop-format', () => {
    const result = dbCropToCrop(mockDBCrop);
    
    expect(result).toEqual({
      id: 'crop-001',
      name: 'Höstvete',
      category: 'spannmål',
      unit: 'ton',
      nutrientPerTon: {
        N: 22,
        P: 4,
        K: 5,
        S: 2,
      },
      typicalYield: {
        min: 4,
        max: 10,
        average: 7,
      },
      precropEffect: {
        nEffect: 0,
        yieldEffect: 0,
      },
      description: 'Vanligt höstvete',
      source: {
        provider: 'Jordbruksverket',
        note: 'Rekommendationer 2024',
        url: 'https://example.com',
      },
    });
  });

  it('ska hantera grödor utan valfria fält', () => {
    const minimalCrop: DBCrop = {
      id: 'crop-002',
      name: 'Vårkorn',
      category: 'spannmål',
      unit: 'ton',
      n_per_ton: 18,
      p_per_ton: 3.5,
      k_per_ton: 4.5,
      s_per_ton: null,
      yield_min: 3,
      yield_max: 8,
      yield_average: 5.5,
      precrop_n_effect: 0,
      precrop_yield_effect: 0,
      description: null,
      source_provider: null,
      source_note: null,
      source_url: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    
    const result = dbCropToCrop(minimalCrop);
    
    expect(result.nutrientPerTon.S).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.source.provider).toBe('Jordbruksverket'); // Default
    expect(result.source.note).toBe('');
    expect(result.source.url).toBeUndefined();
  });

  it('ska hantera förfrukt med N-effekt', () => {
    const precropWithEffect: DBCrop = {
      ...mockDBCrop,
      id: 'precrop-001',
      name: 'Klöver',
      category: 'vall',
      precrop_n_effect: 40,
      precrop_yield_effect: 5,
    };
    
    const result = dbCropToCrop(precropWithEffect);
    
    expect(result.precropEffect?.nEffect).toBe(40);
    expect(result.precropEffect?.yieldEffect).toBe(5);
  });
});
