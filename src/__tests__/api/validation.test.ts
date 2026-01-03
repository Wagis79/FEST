/**
 * FEST - Validering Enhetstester
 * 
 * Testar alla valideringsschemas och hjälpfunktioner
 */

import { describe, it, expect, vi } from 'vitest';
import {
  NutrientNeedSchema,
  StrategySchema,
  RecommendRequestSchema,
  OptimizeV7RequestSchema,
  NutrientNeedRequestSchema,
  CreateCropSchema,
  AdminProductSchema,
  M3WebhookSchema,
  generateInputWarnings,
  validateBody,
  validateQuery,
} from '../../api/validation';
import { z } from 'zod';

// Mock helpers for Express Request/Response
// We use explicit casts because mocking Express types fully is complex and not the focus of these tests
interface MockRequest {
  body: Record<string, unknown>;
  query: Record<string, unknown>;
  path: string;
  validatedQuery?: Record<string, unknown>;
}

interface MockResponse {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function createMockReq(overrides: Partial<MockRequest> = {}): MockRequest {
  return { path: '/test', body: {}, query: {}, ...overrides };
}

function createMockRes(): MockResponse {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

// ============================================================================
// NUTRIENT NEED SCHEMA
// ============================================================================

describe('NutrientNeedSchema', () => {
  
  it('ska validera giltigt näringsbehov', () => {
    const valid = { N: 120, P: 20, K: 50, S: 10 };
    const result = NutrientNeedSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('ska tillåta partiellt näringsbehov', () => {
    const partial = { N: 100 };
    const result = NutrientNeedSchema.safeParse(partial);
    expect(result.success).toBe(true);
  });

  it('ska avvisa tomt objekt (minst ett näringsämne krävs)', () => {
    const empty = {};
    const result = NutrientNeedSchema.safeParse(empty);
    expect(result.success).toBe(false);
  });

  it('ska avvisa negativa värden', () => {
    const negative = { N: -10, P: 20 };
    const result = NutrientNeedSchema.safeParse(negative);
    expect(result.success).toBe(false);
  });

  it('ska avvisa för höga värden', () => {
    const tooHigh = { N: 9999, P: 20 };
    const result = NutrientNeedSchema.safeParse(tooHigh);
    expect(result.success).toBe(false);
  });

});

// ============================================================================
// STRATEGY SCHEMA
// ============================================================================

describe('StrategySchema', () => {
  
  it('ska acceptera economic', () => {
    const result = StrategySchema.safeParse('economic');
    expect(result.success).toBe(true);
  });

  it('ska acceptera optimized', () => {
    const result = StrategySchema.safeParse('optimized');
    expect(result.success).toBe(true);
  });

  it('ska avvisa ogiltiga strategier', () => {
    const result = StrategySchema.safeParse('aggressive');
    expect(result.success).toBe(false);
  });

  it('ska defaulta till economic', () => {
    const result = StrategySchema.parse(undefined);
    expect(result).toBe('economic');
  });

});

// ============================================================================
// RECOMMEND REQUEST SCHEMA
// ============================================================================

describe('RecommendRequestSchema', () => {
  
  it('ska validera minimal giltig request', () => {
    const valid = { need: { N: 100 } };
    const result = RecommendRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('ska validera full request med alla fält', () => {
    const full = {
      need: { N: 120, P: 20, K: 50, S: 10 },
      maxProducts: 3,
      strategy: 'optimized',
      requiredNutrients: ['N', 'P'],
      excludedProductIds: ['prod-123'],
      requiredProductIds: ['prod-456'],
    };
    const result = RecommendRequestSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('ska avvisa ogiltig maxProducts', () => {
    const invalid = { need: { N: 100 }, maxProducts: 10 };
    const result = RecommendRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('ska avvisa utan need', () => {
    const noNeed = { maxProducts: 3 };
    const result = RecommendRequestSchema.safeParse(noNeed);
    expect(result.success).toBe(false);
  });

});

// ============================================================================
// OPTIMIZE V7 REQUEST SCHEMA
// ============================================================================

describe('OptimizeV7RequestSchema', () => {
  
  it('ska validera minimal request', () => {
    const valid = {
      need: { N: 100, P: 20, K: 40, S: 10 },
      products: [{ id: 'p1', name: 'Test', pricePerTon: 5000, n: 20, p: 0, k: 0, s: 0 }],
    };
    const result = OptimizeV7RequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('ska avvisa utan produkter (minst 1 krävs)', () => {
    const noProducts = { need: { N: 100 }, products: [] };
    const result = OptimizeV7RequestSchema.safeParse(noProducts);
    // Schema kräver minst 1 produkt
    expect(result.success).toBe(false);
  });

  it('ska validera full request med alla fält', () => {
    const full = {
      need: { N: 150, P: 30, K: 60, S: 15 },
      products: [
        { id: 'p1', name: 'N-34', pricePerTon: 5500, n: 34, p: 0, k: 0, s: 0 },
        { id: 'p2', name: 'NPK', pricePerTon: 6000, n: 21, p: 4, k: 10, s: 3 },
      ],
      requiredNutrients: ['N', 'P'],
      maxProducts: 3,
      strategy: 'optimized',
      topN: 5,
      requiredProductIds: ['p1'],
      excludedProductIds: [],
    };
    const result = OptimizeV7RequestSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

});

// ============================================================================
// NUTRIENT NEED REQUEST SCHEMA
// ============================================================================

describe('NutrientNeedRequestSchema', () => {
  
  it('ska validera giltig gröd-request', () => {
    const valid = { cropId: 'c-123', expectedYield: 6000 };
    const result = NutrientNeedRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('ska avvisa utan cropId', () => {
    const noCrop = { expectedYield: 6000 };
    const result = NutrientNeedRequestSchema.safeParse(noCrop);
    expect(result.success).toBe(false);
  });

  it('ska avvisa negativ skörd', () => {
    const negativeYield = { cropId: 'c-123', expectedYield: -100 };
    const result = NutrientNeedRequestSchema.safeParse(negativeYield);
    expect(result.success).toBe(false);
  });

});

// ============================================================================
// CREATE CROP SCHEMA
// ============================================================================

describe('CreateCropSchema', () => {
  
  it('ska validera giltig gröda', () => {
    const valid = {
      id: 'c-hostvete',
      name: 'Höstvete',
      category: 'spannmål',
      nutrientUptake: {
        N: 25,
        P: 5,
        K: 5,
        S: 2,
      },
    };
    const result = CreateCropSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('ska validera gröda med alla fält', () => {
    const full = {
      id: 'c-aker-bona',
      name: 'Åkerböna',
      category: 'baljväxter',
      yieldUnit: 'ton',
      nutrientUptake: { N: 30, P: 6, K: 8, S: 3 },
      precropEffect: { nEffect: 30, yieldEffect: 500 },
    };
    const result = CreateCropSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('ska avvisa utan namn', () => {
    const noName = {
      id: 'c-test',
      category: 'spannmål',
      nutrientUptake: { N: 25, P: 5, K: 5 },
    };
    const result = CreateCropSchema.safeParse(noName);
    expect(result.success).toBe(false);
  });

  it('ska avvisa utan nutrientUptake', () => {
    const noNutrients = {
      id: 'c-test',
      name: 'Test',
      category: 'test',
    };
    const result = CreateCropSchema.safeParse(noNutrients);
    expect(result.success).toBe(false);
  });

});

// ============================================================================
// ADMIN PRODUCT SCHEMA
// ============================================================================

describe('AdminProductSchema', () => {
  
  it('ska validera giltig produkt', () => {
    const valid = {
      name: 'N-34',
      pricePerTon: 5500,
      n: 34,
      p: 0,
      k: 0,
      s: 0,
    };
    const result = AdminProductSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('ska validera produkt med alla fält', () => {
    const full = {
      id: 'prod-123',
      name: 'NPK 21-4-10',
      pricePerTon: 6200,
      n: 21,
      p: 4,
      k: 10,
      s: 3,
      density: 1.1,
      minSpread: 50,
      maxSpread: 400,
      isOptimizable: true,
      active: true,
    };
    const result = AdminProductSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('ska avvisa negativt pris', () => {
    const negativePrice = {
      name: 'Test',
      pricePerTon: -5000,
      n: 20,
      p: 0,
      k: 0,
      s: 0,
    };
    const result = AdminProductSchema.safeParse(negativePrice);
    expect(result.success).toBe(false);
  });

  it('ska avvisa för högt näringsinnehåll', () => {
    const tooHigh = {
      name: 'Test',
      pricePerTon: 5000,
      n: 150, // Max is 100
      p: 0,
      k: 0,
      s: 0,
    };
    const result = AdminProductSchema.safeParse(tooHigh);
    expect(result.success).toBe(false);
  });

});

// ============================================================================
// M3 WEBHOOK SCHEMA
// ============================================================================

describe('M3WebhookSchema', () => {
  
  it('ska validera giltig M3-webhook', () => {
    const valid = {
      event: 'product.updated',
      data: { itemNumber: '301763', pricePerTon: 5500 },
    };
    const result = M3WebhookSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('ska validera M3-webhook med status', () => {
    const valid = {
      event: 'product.updated',
      data: { itemNumber: '301763', active: false },
    };
    const result = M3WebhookSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('ska validera M3-webhook med timestamp', () => {
    const valid = {
      event: 'product.created',
      timestamp: '2025-01-15T10:30:00Z',
      data: { itemNumber: '301763', pricePerTon: 5500, active: true },
    };
    const result = M3WebhookSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('ska avvisa utan event', () => {
    const noEvent = {
      data: { itemNumber: '301763', pricePerTon: 5500 },
    };
    const result = M3WebhookSchema.safeParse(noEvent);
    expect(result.success).toBe(false);
  });

  it('ska avvisa utan itemNumber', () => {
    const noItem = {
      event: 'product.updated',
      data: { pricePerTon: 5500 },
    };
    const result = M3WebhookSchema.safeParse(noItem);
    expect(result.success).toBe(false);
  });

});

// ============================================================================
// GENERATE INPUT WARNINGS
// ============================================================================

describe('generateInputWarnings', () => {
  
  // Helper för att skapa giltig input
  const makeInput = (overrides: Partial<{ 
    need: { N?: number; P?: number; K?: number; S?: number };
    maxProducts?: number;
    requiredProductIds?: string[];
    excludedProductIds?: string[];
  }>) => ({
    need: overrides.need ?? { N: 100 },
    strategy: 'economic' as const,
    maxProducts: overrides.maxProducts ?? 3,
    topN: 10,
    requiredProductIds: overrides.requiredProductIds,
    excludedProductIds: overrides.excludedProductIds,
  });

  it('ska inte ge varningar för normal input', () => {
    const normal = makeInput({ need: { N: 120, P: 20, K: 50, S: 10 } });
    const warnings = generateInputWarnings(normal);
    expect(warnings).toHaveLength(0);
  });

  it('ska varna för lågt näringsbehov', () => {
    const low = makeInput({ need: { N: 5, P: 2 } });
    const warnings = generateInputWarnings(low);
    expect(warnings.some(w => w.includes('Lågt totalt näringsbehov'))).toBe(true);
  });

  it('ska varna för högt N-behov', () => {
    const highN = makeInput({ need: { N: 500, P: 20 } });
    const warnings = generateInputWarnings(highN);
    expect(warnings.some(w => w.includes('Högt N-behov'))).toBe(true);
  });

  it('ska varna för extremt totalt behov', () => {
    const extreme = makeInput({ need: { N: 400, P: 100, K: 200, S: 50 } });
    const warnings = generateInputWarnings(extreme);
    expect(warnings.some(w => w.includes('Extremt högt totalt näringsbehov'))).toBe(true);
  });

  it('ska varna när alla slots är tvingade', () => {
    const allForced = makeInput({
      need: { N: 100 },
      maxProducts: 2,
      requiredProductIds: ['p1', 'p2'],
    });
    const warnings = generateInputWarnings(allForced);
    expect(warnings.some(w => w.includes('Alla produktslots är tvingade'))).toBe(true);
  });

  it('ska varna för många exkluderade produkter', () => {
    const manyExcluded = makeInput({
      need: { N: 100 },
      excludedProductIds: Array.from({ length: 20 }, (_, i) => `p${i}`),
    });
    const warnings = generateInputWarnings(manyExcluded);
    expect(warnings.some(w => w.includes('Många exkluderade produkter'))).toBe(true);
  });

  it('ska kunna ge flera varningar samtidigt', () => {
    const multiProblems = makeInput({
      need: { N: 500, P: 100, K: 150, S: 50 },
      maxProducts: 2,
      requiredProductIds: ['p1', 'p2'],
    });
    const warnings = generateInputWarnings(multiProblems);
    expect(warnings.length).toBeGreaterThan(1);
  });

});

// ============================================================================
// VALIDATE BODY MIDDLEWARE
// ============================================================================

describe('validateBody middleware', () => {
  const TestSchema = z.object({
    name: z.string().min(1),
    value: z.number().min(0),
  });

  it('ska kalla next() för giltig body', () => {
    const middleware = validateBody(TestSchema);
    const req = createMockReq({ body: { name: 'test', value: 42 } });
    const res = createMockRes();
    const next = vi.fn();

    middleware(req as unknown as Parameters<typeof middleware>[0], res as unknown as Parameters<typeof middleware>[1], next);

    expect(next).toHaveBeenCalled();
    // validateBody ersätter req.body med parsad data
    expect(req.body).toEqual({ name: 'test', value: 42 });
  });

  it('ska ge 400 för ogiltig body', () => {
    const middleware = validateBody(TestSchema);
    const req = createMockReq({ body: { name: '', value: -1 } });
    const res = createMockRes();
    const next = vi.fn();

    middleware(req as unknown as Parameters<typeof middleware>[0], res as unknown as Parameters<typeof middleware>[1], next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

});

// ============================================================================
// VALIDATE QUERY MIDDLEWARE
// ============================================================================

describe('validateQuery middleware', () => {
  const QuerySchema = z.object({
    page: z.coerce.number().min(1).optional(),
    limit: z.coerce.number().min(1).max(100).optional(),
  });

  it('ska kalla next() för giltig query', () => {
    const middleware = validateQuery(QuerySchema);
    const req = createMockReq({ query: { page: '1', limit: '20' } });
    const res = createMockRes();
    const next = vi.fn();

    middleware(req as unknown as Parameters<typeof middleware>[0], res as unknown as Parameters<typeof middleware>[1], next);

    expect(next).toHaveBeenCalled();
    expect(req.validatedQuery).toEqual({ page: 1, limit: 20 });
  });

  it('ska ge 400 för ogiltiga query-parametrar', () => {
    const middleware = validateQuery(QuerySchema);
    const req = createMockReq({ query: { page: '0', limit: '999' } });
    const res = createMockRes();
    const next = vi.fn();

    middleware(req as unknown as Parameters<typeof middleware>[0], res as unknown as Parameters<typeof middleware>[1], next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

});
