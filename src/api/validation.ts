/**
 * FEST API Input Validation Schemas
 * 
 * Använder Zod för typsäker validering av alla API-requests.
 * Centraliserad validering ger:
 * - Konsistent felhantering
 * - Automatisk TypeScript-typning
 * - Tydliga felmeddelanden
 */

import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import log from '../utils/logger';

// =============================================================================
// GRUNDLÄGGANDE SCHEMAN
// =============================================================================

/**
 * Näringsämnen - alla är optionella men minst ett måste anges
 */
export const NutrientNeedSchema = z.object({
  N: z.number().min(0).max(500).optional(),
  P: z.number().min(0).max(200).optional(),
  K: z.number().min(0).max(300).optional(),
  S: z.number().min(0).max(100).optional(),
}).refine(
  (data) => data.N !== undefined || data.P !== undefined || data.K !== undefined || data.S !== undefined,
  { message: 'Minst ett näringsämne (N, P, K eller S) måste anges' }
);

/**
 * Strategier för optimering
 */
export const StrategySchema = z.enum(['economic', 'optimized']).default('economic');

/**
 * Näringsämnen som måste uppfyllas
 */
export const RequiredNutrientsSchema = z.array(
  z.enum(['N', 'P', 'K', 'S'])
).optional();

// =============================================================================
// API ENDPOINT SCHEMAN
// =============================================================================

/**
 * POST /api/recommend
 */
export const RecommendRequestSchema = z.object({
  need: NutrientNeedSchema,
  strategy: StrategySchema,
  maxProducts: z.number().int().min(1).max(5).optional().default(3),
  topN: z.number().int().min(1).max(50).optional().default(10),
  requiredNutrients: RequiredNutrientsSchema,
  excludedProductIds: z.array(z.string()).optional(),
  requiredProductIds: z.array(z.string()).optional(),
}).refine(
  (data) => {
    // Validera att required och excluded inte överlappar
    if (data.requiredProductIds && data.excludedProductIds) {
      const requiredSet = new Set(data.requiredProductIds);
      const hasConflict = data.excludedProductIds.some(id => requiredSet.has(id));
      return !hasConflict;
    }
    return true;
  },
  { message: 'Produkter kan inte vara både required och excluded' }
).refine(
  (data) => {
    // Validera att antal required inte överstiger maxProducts
    const maxProducts = data.maxProducts ?? 3;
    return !data.requiredProductIds || data.requiredProductIds.length <= maxProducts;
  },
  { message: 'Antal tvingade produkter överstiger maxProducts' }
);

export type RecommendRequest = z.infer<typeof RecommendRequestSchema>;

/**
 * POST /api/optimize-v7
 */
export const OptimizeV7RequestSchema = z.object({
  need: NutrientNeedSchema,
  products: z.array(z.object({
    id: z.string(),
    name: z.string(),
    pricePerTon: z.number().min(0),
    n: z.number().min(0).max(100),
    p: z.number().min(0).max(100),
    k: z.number().min(0).max(100),
    s: z.number().min(0).max(100),
    density: z.number().min(0).max(2).optional(),
    minSpread: z.number().min(0).optional(),
    maxSpread: z.number().min(0).optional(),
  })).min(1).max(100),
  requiredNutrients: RequiredNutrientsSchema,
  maxProducts: z.number().int().min(1).max(5).optional().default(3),
  strategy: StrategySchema,
  topN: z.number().int().min(1).max(50).optional().default(5),
  requiredProductIds: z.array(z.string()).optional(),
  excludedProductIds: z.array(z.string()).optional(),
});

export type OptimizeV7Request = z.infer<typeof OptimizeV7RequestSchema>;

/**
 * POST /api/nutrient-need
 */
export const NutrientNeedRequestSchema = z.object({
  cropId: z.string().min(1, 'cropId krävs'),
  expectedYield: z.number().min(0).max(50000),
  precropId: z.string().optional(),
  soilClass: z.number().int().min(1).max(5).optional(),
  pkClass: z.number().int().min(1).max(5).optional(),
});

export type NutrientNeedRequest = z.infer<typeof NutrientNeedRequestSchema>;

/**
 * POST /api/crops (create)
 */
export const CreateCropSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  yieldUnit: z.string().optional().default('kg'),
  nutrientUptake: z.object({
    N: z.number().min(0),
    P: z.number().min(0),
    K: z.number().min(0),
    S: z.number().min(0).optional(),
  }),
  precropEffect: z.object({
    nEffect: z.number(),
    yieldEffect: z.number(),
  }).optional(),
});

export type CreateCrop = z.infer<typeof CreateCropSchema>;

/**
 * POST /api/admin/products (create/update)
 */
export const AdminProductSchema = z.object({
  id: z.string().optional(), // Optional for create, required for update
  name: z.string().min(1),
  pricePerTon: z.number().min(0),
  n: z.number().min(0).max(100),
  p: z.number().min(0).max(100),
  k: z.number().min(0).max(100),
  s: z.number().min(0).max(100),
  density: z.number().min(0).max(2).optional(),
  minSpread: z.number().min(0).optional(),
  maxSpread: z.number().min(0).optional(),
  isOptimizable: z.boolean().optional().default(true),
  active: z.boolean().optional().default(true),
});

export type AdminProduct = z.infer<typeof AdminProductSchema>;

/**
 * M3 Webhook payload
 */
export const M3WebhookSchema = z.object({
  event: z.enum(['product.created', 'product.updated', 'product.deleted']),
  timestamp: z.string().datetime().optional(),
  data: z.object({
    itemNumber: z.string().min(1),
    name: z.string().optional(),
    pricePerTon: z.number().min(0).optional(),
    n: z.number().min(0).max(100).optional(),
    p: z.number().min(0).max(100).optional(),
    k: z.number().min(0).max(100).optional(),
    s: z.number().min(0).max(100).optional(),
    density: z.number().optional(),
    active: z.boolean().optional(),
  }),
});

export type M3Webhook = z.infer<typeof M3WebhookSchema>;

// =============================================================================
// VALIDERINGS-MIDDLEWARE
// =============================================================================

/**
 * Skapar en Express-middleware som validerar request body mot ett Zod-schema
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    
    if (!result.success) {
      const errors = result.error.issues.map((err: z.ZodIssue) => ({
        field: err.path.join('.'),
        message: err.message,
        code: err.code,
      }));
      
      log.warn('Valideringsfel', { 
        path: req.path, 
        errors,
        body: req.body 
      });
      
      return res.status(400).json({
        success: false,
        error: 'Valideringsfel',
        details: errors,
      });
    }
    
    // Ersätt body med validerad och transformerad data
    req.body = result.data;
    next();
  };
}

/**
 * Validerar query-parametrar
 */
export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    
    if (!result.success) {
      const errors = result.error.issues.map((err: z.ZodIssue) => ({
        field: err.path.join('.'),
        message: err.message,
      }));
      
      return res.status(400).json({
        success: false,
        error: 'Ogiltiga query-parametrar',
        details: errors,
      });
    }
    
    // Spara validerad data i en custom property
    (req as Request & { validatedQuery: z.infer<T> }).validatedQuery = result.data;
    next();
  };
}

// =============================================================================
// VARNINGS-GENERATOR
// =============================================================================

/**
 * Genererar varningar baserat på input-värden
 * Returnerar array med varningsmeddelanden
 */
export function generateInputWarnings(data: RecommendRequest): string[] {
  const warnings: string[] = [];
  const need = data.need;
  const maxProducts = data.maxProducts ?? 3;
  
  // Beräkna totalt näringsbehov
  const totalNeed = (need.N || 0) + (need.P || 0) + (need.K || 0) + (need.S || 0);
  
  // Varning: För lågt näringsbehov
  if (totalNeed < 20) {
    warnings.push(`Lågt totalt näringsbehov (${totalNeed} kg/ha). Rekommendation: minst 20 kg/ha.`);
  }
  
  // Varning: Högt N-behov
  if (need.N && need.N > 400) {
    warnings.push(`Högt N-behov (${need.N} kg/ha). Risk för längre beräkningstid.`);
  }
  
  // Varning: Extremt högt totalt behov
  if (totalNeed > 600) {
    warnings.push(`Extremt högt totalt näringsbehov (${totalNeed} kg/ha).`);
  }
  
  // Varning: Alla slots tvingade
  if (data.requiredProductIds && data.requiredProductIds.length >= maxProducts) {
    warnings.push(`Alla produktslots är tvingade (${data.requiredProductIds.length}/${maxProducts}).`);
  }
  
  // Varning: Många exkluderade produkter
  if (data.excludedProductIds && data.excludedProductIds.length > 15) {
    warnings.push(`Många exkluderade produkter (${data.excludedProductIds.length}).`);
  }
  
  return warnings;
}
