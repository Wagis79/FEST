/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { calculateNutrientNeed, calculateNutrientNeedWithPrecrop, Crop } from '../data/crops';
import { recommend, RecommendOptions } from '../engine/recommend';
import { optimizeV7, OptimizeV7Input, OptimizeV7Output } from '../engine/optimize-v7';
import { NutrientNeed } from '../models/NutrientNeed';
import { Strategy } from '../engine/scoring';
import { Product } from '../models/Product';
import { 
  supabase,
  supabaseAdmin,
  PRODUCTS_TABLE, 
  dbProductToProduct, 
  dbProductToAdminProduct,
  productToDBProduct,
  getAllProductsForRecommendation,
  getProductsForRecommendation,
  getAllCrops,
  getCropById,
  getCropsByCategory,
  getAlgorithmConfigMap,
  deleteLegacyEngineConfig,
  updateProductFromM3
} from './supabase';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Admin password from environment
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// M3 Webhook secret for ERP integration
const M3_WEBHOOK_SECRET = process.env.M3_WEBHOOK_SECRET || '';

// API Keys for external access (comma-separated in env)
const API_KEYS = new Set(
  (process.env.API_KEYS || '')
    .split(',')
    .map(key => key.trim())
    .filter(key => key.length > 0)
);

// Log API key status on startup
if (API_KEYS.size > 0) {
  console.log(`🔑 ${API_KEYS.size} API-nyckel(ar) konfigurerade`);
} else {
  console.log('⚠️  Inga API-nycklar konfigurerade - externt API-åtkomst är öppen');
}

// Simple password check middleware for admin
function requireAdminPassword(req: Request, res: Response, next: NextFunction) {
  const password = req.headers['x-admin-password'];
  
  if (password === ADMIN_PASSWORD) {
    next();
  } else {
    res.status(403).json({
      success: false,
      error: 'Felaktigt admin-lösenord'
    });
  }
}

/**
 * API Key middleware for external API access
 * Checks X-API-Key header against configured keys
 * If no keys are configured, access is open (for development)
 * Same-origin requests (from our frontend) are allowed without API key
 */
function requireApiKey(req: Request, res: Response, next: NextFunction) {
  // If no API keys configured, allow access (development mode)
  if (API_KEYS.size === 0) {
    return next();
  }

  // Check if request is from same origin (our frontend)
  // Same-origin requests typically have Referer header matching our host
  // or come from browser without X-API-Key header and with typical browser headers
  const referer = req.headers['referer'] as string;
  const origin = req.headers['origin'] as string;
  const host = req.headers['host'] as string;
  
  // If Referer or Origin matches our host, it's a same-origin request - allow it
  if (referer && host && referer.includes(host)) {
    return next();
  }
  if (origin && host && origin.includes(host)) {
    return next();
  }
  
  // For requests without Referer/Origin but also without API key,
  // check if it looks like a browser request (Accept header includes text/html)
  // This handles initial page loads and navigation
  const accept = req.headers['accept'] as string;
  const apiKey = req.headers['x-api-key'] as string;
  
  // If no API key provided and request accepts HTML, it might be browser navigation
  // But for API calls (Accept: application/json), we need authentication
  if (!apiKey && accept && accept.includes('text/html')) {
    return next();
  }

  // External API request - require API key
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'API-nyckel saknas. Lägg till header: X-API-Key',
      code: 'MISSING_API_KEY'
    });
  }

  if (!API_KEYS.has(apiKey)) {
    return res.status(403).json({
      success: false,
      error: 'Ogiltig API-nyckel',
      code: 'INVALID_API_KEY'
    });
  }

  // Valid API key - proceed
  next();
}

/**
 * Middleware to block external access completely
 * Only allows requests from localhost or without API key header
 * Used for internal endpoints that should not be exposed externally
 */
function blockExternalAccess(req: Request, res: Response, next: NextFunction) {
  // If no API keys configured, we're in development mode - allow all
  if (API_KEYS.size === 0) {
    return next();
  }

  // If request has an API key, it's an external request - block it
  const apiKey = req.headers['x-api-key'] as string;
  if (apiKey) {
    return res.status(403).json({
      success: false,
      error: 'Denna endpoint är inte tillgänglig för externa API-anrop',
      code: 'ENDPOINT_NOT_AVAILABLE'
    });
  }

  // No API key = internal request (from our own frontend) - allow
  next();
}

// Global Middleware
app.use(cors());
app.use(express.json());

// Swagger UI - API Documentation
// Using separate routers to avoid conflicts between multiple swagger instances
try {
  // External API docs (for partners) - hide schemas section
  const openapiPath = path.join(__dirname, '../../openapi.yaml');
  if (fs.existsSync(openapiPath)) {
    const openapiFile = fs.readFileSync(openapiPath, 'utf8');
    const swaggerDocument = YAML.parse(openapiFile);
    
    const externalSwaggerOptions = {
      customCss: `
        .swagger-ui .topbar { display: none }
        .swagger-ui .models { display: none }
      `,
      customSiteTitle: 'FEST API - Extern',
      swaggerOptions: {
        defaultModelsExpandDepth: -1,
        docExpansion: 'list'
      }
    };
    
    app.use('/api-docs', swaggerUi.serveFiles(swaggerDocument, externalSwaggerOptions), swaggerUi.setup(swaggerDocument, externalSwaggerOptions));
    console.log('📚 Swagger UI (extern) available at /api-docs');
  }

  // Internal API docs (complete documentation)
  const openapiInternalPath = path.join(__dirname, '../../openapi-internal.yaml');
  if (fs.existsSync(openapiInternalPath)) {
    const openapiInternalFile = fs.readFileSync(openapiInternalPath, 'utf8');
    const swaggerInternalDocument = YAML.parse(openapiInternalFile);
    
    const internalSwaggerOptions = {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'FEST API - Intern',
      swaggerOptions: {
        docExpansion: 'list'
      }
    };
    
    app.use('/api-docs-internal', swaggerUi.serveFiles(swaggerInternalDocument, internalSwaggerOptions), swaggerUi.setup(swaggerInternalDocument, internalSwaggerOptions));
    console.log('📚 Swagger UI (intern) available at /api-docs-internal');
  }
} catch (err) {
  console.warn('⚠️  Could not load OpenAPI spec for Swagger UI:', err);
}

// Public static files
app.use(express.static(path.join(__dirname, '../../public')));

// Serve index.html for root
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

/**
 * GET /api/products
 * Returnera alla tillgängliga produkter (för rekommendationsmotorn)
 * Tillgänglig för externa API-anrop (endast läsning)
 */
app.get('/api/products', requireApiKey, async (req: Request, res: Response) => {
  try {
    const products = await getAllProductsForRecommendation();
    res.json({
      success: true,
      count: products.length,
      products: products,
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte hämta produkter',
    });
  }
});

/**
 * POST /api/recommend
 * Få rekommendationer baserat på näringsbehov
 * Kräver API-nyckel för extern åtkomst (om konfigurerat)
 * 
 * Body: {
 *   need: { N?: number, P?: number, K?: number, S?: number },
 *   strategy?: 'cheapest' | 'balanced' | 'most_exact',
 *   maxProducts?: 1 | 2,
 *   topN?: number
 * }
 */
app.post('/api/recommend', requireApiKey, async (req: Request, res: Response) => {
  try {
  const { need, strategy = 'economic', maxProducts, topN = 10, requiredNutrients, excludedProductIds, requiredProductIds } = req.body;

    console.log('📥 /api/recommend request:', { 
      need, 
      strategy, 
      maxProducts: maxProducts, 
      maxProductsType: typeof maxProducts,
      topN, 
      requiredNutrients,
      excludedProductIds: excludedProductIds ? excludedProductIds.length : 0,
      requiredProductIds: requiredProductIds ? requiredProductIds.length : 0
    });

    // Validera input
    if (!need || typeof need !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Näringsbehov (need) krävs och måste vara ett objekt',
      });
    }

    // Validera att minst ett näringsämne finns
    if (!need.N && !need.P && !need.K && !need.S) {
      return res.status(400).json({
        success: false,
        error: 'Minst ett näringsämne måste anges',
      });
    }

    // Validera strategi
    const validStrategies: Strategy[] = ['economic', 'optimized'];
    if (!validStrategies.includes(strategy)) {
      return res.status(400).json({
        success: false,
        error: 'Strategi måste vara economic eller optimized',
      });
    }
    
    // Validera att required och excluded inte överlappar
    if (requiredProductIds && excludedProductIds) {
      const requiredSet = new Set(requiredProductIds);
      const conflictIds = excludedProductIds.filter((id: string) => requiredSet.has(id));
      if (conflictIds.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Produkter kan inte vara både required och excluded: ${conflictIds.join(', ')}`,
          code: 'REQUIRED_EXCLUDED_CONFLICT'
        });
      }
    }
    
    // Validera att antal required inte överstiger maxProducts
    const effectiveMaxProducts = maxProducts || 3;
    if (requiredProductIds && requiredProductIds.length > effectiveMaxProducts) {
      return res.status(400).json({
        success: false,
        error: `Antal tvingade produkter (${requiredProductIds.length}) överstiger maxProducts (${effectiveMaxProducts})`,
        code: 'TOO_MANY_REQUIRED_PRODUCTS'
      });
    }
    
    // Validera gränsvärden baserat på testresultat
    const warnings: string[] = [];
    
    // Beräkna totalt näringsbehov
    const totalNeed = (need.N || 0) + (need.P || 0) + (need.K || 0) + (need.S || 0);
    
    // Varning: För lågt näringsbehov (< 20 kg/ha totalt)
    if (totalNeed < 20) {
      warnings.push(`Lågt totalt näringsbehov (${totalNeed} kg/ha). Rekommendation: minst 20 kg/ha för stabila lösningar.`);
    }
    
    // Varning: För högt N-behov (> 400 kg/ha)
    if (need.N && need.N > 400) {
      warnings.push(`Högt N-behov (${need.N} kg/ha). Risk för längre beräkningstid eller minnesfel. Rekommendation: max 400 kg N/ha.`);
    }
    
    // Varning: Extremt högt totalt behov (> 600 kg/ha)
    if (totalNeed > 600) {
      warnings.push(`Extremt högt totalt näringsbehov (${totalNeed} kg/ha). Risk för prestanda-problem.`);
    }
    
    // Varning: För många tvingade produkter (lämna minst 1 slot för optimeraren)
    if (requiredProductIds && requiredProductIds.length >= effectiveMaxProducts) {
      warnings.push(`Alla produktslots är tvingade (${requiredProductIds.length}/${effectiveMaxProducts}). Optimeraren har ingen flexibilitet.`);
    }
    
    // Varning: Många exkluderade produkter
    if (excludedProductIds && excludedProductIds.length > 15) {
      warnings.push(`Många exkluderade produkter (${excludedProductIds.length}). Detta kan begränsa lösningsutrymmet.`);
    }
    
    // Logga varningar
    if (warnings.length > 0) {
      console.log('⚠️  Valideringsvarningar:', warnings);
    }

  // Hämta produkter från Supabase (behovsstyrt urval för bättre träffbild)
  let products = await getProductsForRecommendation(need as NutrientNeed, strategy);
    
  // Filtrera bort användarexkluderade produkter
  if (excludedProductIds && Array.isArray(excludedProductIds) && excludedProductIds.length > 0) {
    const excludedSet = new Set(excludedProductIds);
    const originalCount = products.length;
    products = products.filter(p => !excludedSet.has(p.id));
    console.log(`🚫 Exkluderade ${originalCount - products.length} produkter (${excludedProductIds.length} angivna)`);
  }
    
    if (products.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Inga produkter tillgängliga för beräkning',
      });
    }

    // Hämta algoritmkonfiguration från databasen
    let algorithmConfig;
    try {
      algorithmConfig = await getAlgorithmConfigMap();
      console.log('⚙️  Algoritmkonfiguration laddad för /recommend');
    } catch (configErr) {
      console.warn('⚠️  Kunde inte ladda algoritmkonfiguration, använder defaults:', configErr);
      // Fortsätt med defaults om config inte kan laddas
    }

    // Kör rekommendationsmotor med användarens val av maxProducts.
    const options: RecommendOptions = {
      strategy,
      maxProducts: maxProducts,
      topN,
      requiredNutrients: requiredNutrients || undefined,
      algorithmConfig,
      requiredProductIds: requiredProductIds || undefined,
    };

    const solutions = await recommend(need as NutrientNeed, products, options);

    // Bygg respons med varningar om de finns
    const response: Record<string, unknown> = {
      success: true,
      count: solutions.length,
      need,
      strategy,
      requiredNutrients: requiredNutrients || [],
      requiredProductIds: requiredProductIds || [],
      solutions,
    };
    
    // Lägg till varningar i responsen om det finns några
    if (warnings.length > 0) {
      response.warnings = warnings;
    }
    
    // Lägg till rekommenderade gränsvärden i responsen
    response.limits = {
      maxProducts: { min: 1, max: 5, recommended: 3 },
      requiredProductIds: { max: effectiveMaxProducts, recommended: Math.max(1, effectiveMaxProducts - 1) },
      totalNeed: { min: 20, max: 600, unit: 'kg/ha' },
      nitrogen: { max: 400, unit: 'kg/ha' }
    };

    res.json(response);
  } catch (error) {
    console.error('Error in /api/recommend:', error);
    res.status(500).json({
      success: false,
      error: 'Serverfel vid beräkning av rekommendationer',
    });
  }
});

/**
 * POST /api/optimize-v7
 * MILP-baserad ILP-optimering (v7 - produktionsredo med full specifikation)
 * 
 * Body: {
 *   targets: { N?: number, P?: number, K?: number, S?: number },
 *   mustFlags: { mustN?: boolean, mustP?: boolean, mustK?: boolean, mustS?: boolean },
 *   maxProducts?: number (1-4, default 2),
 *   minDose?: number (default 100),
 *   maxDose?: number (default 600)
 * }
 * 
 * Funktioner:
 * - Validering: minst ett ämne aktiverat, target >= 1 för aktiverade
 * - N: exakt target..target+tol (eskalerar tol vid behov)
 * - P/K/S: 85%-125% av target
 * - Single nutrient mode: ranking av enskilda produkter
 * - Prispall med 3 strategier via no-good cuts
 * - Warnings för ej aktiverade ämnen med hög nivå
 */
app.post('/api/optimize-v7', blockExternalAccess, async (req: Request, res: Response) => {
  try {
    const { 
      targets, 
      mustFlags = {}, 
      maxProducts = 2, 
      minDose = 100, 
      maxDose = 600 
    } = req.body;

    console.log('📥 /api/optimize-v7 request:', { 
      targets, 
      mustFlags, 
      maxProducts,
      minDose,
      maxDose 
    });

    // Validera targets
    if (!targets || typeof targets !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'targets krävs och måste vara ett objekt med N, P, K, S',
      });
    }

    // Validera maxProducts (hård cap 4)
    const maxProd = Math.min(4, Math.max(1, parseInt(maxProducts) || 2));

    // Hämta alla produkter
    const products = await getAllProductsForRecommendation();
    
    if (products.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Inga produkter tillgängliga för optimering',
      });
    }

    console.log(`🔧 V7-optimering med ${products.length} produkter`);

    // Kör V7-optimering
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
      maxProductsUser: maxProd,
      minDoseKgHa: minDose,
      maxDoseKgHa: maxDose,
    };

    // Hämta algoritmkonfiguration från databasen
    try {
      const algorithmConfig = await getAlgorithmConfigMap();
      input.config = algorithmConfig;
      console.log('⚙️  Algoritmkonfiguration laddad för /optimize-v7');
    } catch (configErr) {
      console.warn('⚠️  Kunde inte ladda algoritmkonfiguration, använder defaults:', configErr);
    }

    const result = await optimizeV7(products, input);

    console.log(`✅ V7 returnerade: ${result.strategies.length} strategier, status: ${result.status}`);

    res.json({
      success: result.status === 'ok',
      ...result,
    });
  } catch (error) {
    console.error('Error in /api/optimize-v7:', error);
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
 * Returnera alla tillgängliga grödor från Supabase
 * Tillgänglig för externa API-anrop (endast läsning)
 */
app.get('/api/crops', requireApiKey, async (req: Request, res: Response) => {
  try {
    const category = req.query.category as string | undefined;
    
    let crops;
    if (category) {
      crops = await getCropsByCategory(category as any);
    } else {
      crops = await getAllCrops();
    }
    
    if (crops.length === 0) {
      console.error('❌ Inga grödor hittades i databasen');
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
    console.error('Error fetching crops:', error);
    res.status(500).json({
      success: false,
      error: 'Serverfel vid hämtning av grödor',
    });
  }
});

/**
 * POST /api/calculate-need
 * Beräkna näringsbehov från gröda och skörd
 * Tillgänglig för externa API-anrop (endast läsning/beräkning)
 * 
 * Body: {
 *   cropId: string,
 *   yieldTonPerHa: number,
 *   precropId?: string  // Valfri förfrukt
 * }
 */
app.post('/api/calculate-need', requireApiKey, async (req: Request, res: Response) => {
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

    // Hämta förfrukt om angiven
    const precrop = precropId ? await getCropById(precropId) : null;
    
    // Beräkna med eller utan förfruktseffekt
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
    console.error('Error in /api/calculate-need:', error);
    res.status(500).json({
      success: false,
      error: 'Serverfel vid beräkning av näringsbehov',
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    status: 'OK',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// ADMIN API ENDPOINTS (Supabase Integration)
// Protected with simple password check
// ============================================================================

// Protect all admin API routes with password
app.use('/api/admin', requireAdminPassword);

/**
 * GET /api/admin/products
 * Fetch all products from Supabase database
 */
app.get('/api/admin/products', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from(PRODUCTS_TABLE)
      .select('*')
      .order('Produkt', { ascending: true });

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch products from database',
        details: error.message,
      });
    }

    // Return raw database data (no transformation)
    res.json(data || []);
  } catch (error: any) {
    console.error('Server error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message,
    });
  }
});

/**
 * POST /api/admin/products
 * Add a new product to Supabase database
 */
app.post('/api/admin/products', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const product = req.body;

    // Check if data is in DB format (from admin.js) or app format
    let dbProduct: any;
    if (product.Artikelnr !== undefined && product.Produkt !== undefined) {
      // Already in DB format from admin.js
      dbProduct = { ...product };
      // Remove fields that don't exist in the database
      delete dbProduct.idx;
    } else {
      // App format - validate required fields
      if (!product.id || !product.name || product.pricePerKg === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: id, name, pricePerKg',
        });
      }
      // Transform to DB format
      dbProduct = productToDBProduct(product);
    }

    // Insert into Supabase using admin client (bypasses RLS)
    const { data, error } = await supabaseAdmin
      .from(PRODUCTS_TABLE)
      .insert([dbProduct])
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to add product to database',
        details: error.message,
      });
    }

    res.json({
      success: true,
      message: 'Product added successfully',
      product: dbProductToProduct(data),
    });
  } catch (error: any) {
    console.error('Server error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message,
    });
  }
});

/**
 * PUT /api/admin/products/:id
 * Update an existing product in Supabase database
 */
app.put('/api/admin/products/:id', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const product = req.body;

    // Extract Artikelnr from id (format: prod-300024)
    const artikelnr = parseInt(id.replace('prod-', ''));

    // If data comes from admin.js (already in DB format with Artikelnr), use directly
    // Otherwise transform from app format
    let dbProduct: any;
    if (product.Artikelnr !== undefined) {
      // Already in DB format from admin.js
      dbProduct = { ...product };
      delete dbProduct.Artikelnr; // Don't update primary key
      delete dbProduct.idx; // Field doesn't exist in database
    } else {
      // App format, transform
      dbProduct = productToDBProduct(product);
    }

    // Update in Supabase using admin client (bypasses RLS)
    const { data, error } = await supabaseAdmin
      .from(PRODUCTS_TABLE)
      .update(dbProduct)
      .eq('Artikelnr', artikelnr)
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to update product in database',
        details: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        error: `Product with id '${id}' not found`,
      });
    }

    res.json({
      success: true,
      message: 'Product updated successfully',
      product: dbProductToProduct(data),
    });
  } catch (error: any) {
    console.error('Server error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message,
    });
  }
});

/**
 * DELETE /api/admin/products/:id
 * Delete a product from Supabase database
 */
app.delete('/api/admin/products/:id', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Extract Artikelnr from id (format: prod-300024)
    const artikelnr = parseInt(id.replace('prod-', ''));

    // Delete from Supabase using admin client (bypasses RLS)
    const { error } = await supabaseAdmin
      .from(PRODUCTS_TABLE)
      .delete()
      .eq('Artikelnr', artikelnr);

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to delete product from database',
        details: error.message,
      });
    }

    res.json({
      success: true,
      message: 'Product deleted successfully',
      productId: id,
    });
  } catch (error: any) {
    console.error('Server error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message,
    });
  }
});

// =============================================================================
// M3 WEBHOOK ENDPOINTS (ERP Integration)
// =============================================================================

/**
 * POST /api/webhook/m3-product
 * Webhook endpoint for M3 CE ERP integration
 * Updates product price and/or active status based on article number
 * 
 * Headers:
 *   X-Webhook-Secret: <shared secret>
 *   Content-Type: application/json
 * 
 * Body:
 * {
 *   "itemNumber": "301763",      // Artikelnummer (matchar Produkter.Artikelnr)
 *   "salesPrice": 4850.00,       // Nytt pris per ton (optional)
 *   "active": true               // Om produkten är aktiv/disponibel (optional)
 * }
 */
app.post('/api/webhook/m3-product', async (req: Request, res: Response) => {
  try {
    // Verify webhook secret
    const webhookSecret = req.headers['x-webhook-secret'] as string;
    
    if (!M3_WEBHOOK_SECRET) {
      console.error('M3 webhook: No M3_WEBHOOK_SECRET configured');
      return res.status(503).json({
        success: false,
        error: 'Webhook not configured',
        code: 'WEBHOOK_NOT_CONFIGURED'
      });
    }

    if (!webhookSecret || webhookSecret !== M3_WEBHOOK_SECRET) {
      console.warn('M3 webhook: Invalid or missing secret');
      return res.status(401).json({
        success: false,
        error: 'Invalid webhook secret',
        code: 'INVALID_SECRET'
      });
    }

    const { itemNumber, salesPrice, active } = req.body;

    // Validate input
    if (!itemNumber) {
      return res.status(400).json({
        success: false,
        error: 'itemNumber is required',
        code: 'MISSING_ITEM_NUMBER'
      });
    }

    const artikelnr = parseInt(itemNumber.toString().replace('prod-', ''));
    if (isNaN(artikelnr)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid itemNumber format',
        code: 'INVALID_ITEM_NUMBER'
      });
    }

    // Build update object
    const updates: { price?: number; active?: boolean } = {};
    
    if (salesPrice !== undefined) {
      const price = parseFloat(salesPrice);
      if (isNaN(price) || price < 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid salesPrice',
          code: 'INVALID_PRICE'
        });
      }
      // Convert price per ton to price per kg
      updates.price = price / 1000;
    }

    if (active !== undefined) {
      updates.active = Boolean(active);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update (salesPrice or active required)',
        code: 'NO_UPDATES'
      });
    }

    // Update product
    const result = await updateProductFromM3(artikelnr, updates);

    if (!result.found) {
      return res.status(404).json({
        success: false,
        error: `Product with artikelnr ${artikelnr} not found`,
        code: 'PRODUCT_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      message: 'Product updated successfully',
      artikelnr,
      updates
    });

  } catch (error: any) {
    console.error('M3 webhook error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * GET /api/admin/product-analysis
 * Analyze product pricing and nutrient costs
 * Returns cost per kg of N, P, K, S for each product
 */
app.get('/api/admin/product-analysis', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    // Get all products
    const products = await getAllProductsForRecommendation();

    // Calculate cost per nutrient for each product
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
      usableNutrients: string[]; // Which nutrients can this product provide
    }

    const analysis: ProductAnalysis[] = products.map(product => {
      const costPerNutrient: ProductAnalysis['costPerNutrient'] = {};
      const usableNutrients: string[] = [];

      // Calculate cost per kg of each nutrient
      // Formula: (pricePerKg / (nutrientPercent / 100))
      // Example: If product costs 10 kr/kg and has 20% N, then N costs 10 / 0.20 = 50 kr/kg
      
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

    // Calculate cheapest sources for each nutrient
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

  } catch (error: any) {
    console.error('Product analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze products',
      details: error.message,
    });
  }
});

// ============================================================================
// CROPS ADMIN API ENDPOINTS
// ============================================================================

/**
 * GET /api/admin/crops
 * Get all crops (raw database format for admin)
 */
app.get('/api/admin/crops', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const { getAllCropsRaw } = await import('./supabase');
    const crops = await getAllCropsRaw();
    res.json(crops);
  } catch (error: any) {
    console.error('Error fetching crops:', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte hämta grödor',
      details: error.message,
    });
  }
});

/**
 * POST /api/admin/crops
 * Create a new crop
 */
app.post('/api/admin/crops', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const { createCrop } = await import('./supabase');
    
    // Validate required fields
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
    
    console.log(`✅ Gröda skapad: ${newCrop.name}`);
    res.status(201).json(newCrop);
  } catch (error: any) {
    console.error('Error creating crop:', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte skapa gröda',
      details: error.message,
    });
  }
});

/**
 * PUT /api/admin/crops/:id
 * Update an existing crop
 */
app.put('/api/admin/crops/:id', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const { updateCrop } = await import('./supabase');
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
    
    console.log(`✅ Gröda uppdaterad: ${cropId}`);
    res.json(updatedCrop);
  } catch (error: any) {
    console.error('Error updating crop:', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte uppdatera gröda',
      details: error.message,
    });
  }
});

/**
 * DELETE /api/admin/crops/:id
 * Delete a crop
 */
app.delete('/api/admin/crops/:id', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const { deleteCrop } = await import('./supabase');
    const cropId = req.params.id;
    
    await deleteCrop(cropId);
    
    console.log(`✅ Gröda borttagen: ${cropId}`);
    res.json({ success: true, message: 'Gröda borttagen' });
  } catch (error: any) {
    console.error('Error deleting crop:', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte ta bort gröda',
      details: error.message,
    });
  }
});

// ============================================================================
// ALGORITHM CONFIG API
// ============================================================================

/**
 * GET /api/admin/config
 * Get all algorithm configuration parameters
 */
app.get('/api/admin/config', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const { getAlgorithmConfig } = await import('./supabase');
    const config = await getAlgorithmConfig();
    
    res.json({
      success: true,
      count: config.length,
      config: config,
    });
  } catch (error: any) {
    console.error('Error fetching algorithm config:', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte hämta algoritmkonfiguration',
      details: error.message,
    });
  }
});

/**
 * GET /api/admin/config/:key
 * Get a specific configuration parameter
 */
app.get('/api/admin/config/:key', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const { getAlgorithmConfig } = await import('./supabase');
    const config = await getAlgorithmConfig();
    const param = config.find(c => c.key === req.params.key);
    
    if (!param) {
      return res.status(404).json({
        success: false,
        error: `Okänd konfigurationsnyckel: ${req.params.key}`,
      });
    }
    
    res.json({
      success: true,
      param: param,
    });
  } catch (error: any) {
    console.error('Error fetching config param:', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte hämta konfigurationsparameter',
      details: error.message,
    });
  }
});

/**
 * PUT /api/admin/config/:key
 * Update a specific configuration parameter
 */
app.put('/api/admin/config/:key', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const { updateAlgorithmConfigValue, getAlgorithmConfig } = await import('./supabase');
    const key = req.params.key;
    const { value } = req.body;
    
    if (value === undefined || value === null) {
      return res.status(400).json({
        success: false,
        error: 'Värde saknas i request body',
      });
    }
    
    const numValue = Number(value);
    if (isNaN(numValue)) {
      return res.status(400).json({
        success: false,
        error: 'Värdet måste vara ett nummer',
      });
    }
    
    await updateAlgorithmConfigValue(key, numValue);
    
    // Hämta uppdaterat värde
    const config = await getAlgorithmConfig();
    const param = config.find(c => c.key === key);
    
    console.log(`✅ Konfiguration uppdaterad: ${key} = ${numValue}`);
    res.json({
      success: true,
      message: `Konfiguration uppdaterad: ${key} = ${numValue}`,
      param: param,
    });
  } catch (error: any) {
    console.error('Error updating config:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Kunde inte uppdatera konfiguration',
    });
  }
});

/**
 * POST /api/admin/config/batch
 * Update multiple configuration parameters at once
 */
app.post('/api/admin/config/batch', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const { updateAlgorithmConfigValue, getAlgorithmConfig } = await import('./supabase');
    const { updates } = req.body;
    
    if (!updates || !Array.isArray(updates)) {
      return res.status(400).json({
        success: false,
        error: 'Request body måste innehålla en "updates" array',
      });
    }
    
    const results: { key: string; success: boolean; error?: string }[] = [];
    
    for (const update of updates) {
      try {
        const numValue = Number(update.value);
        if (isNaN(numValue)) {
          results.push({ key: update.key, success: false, error: 'Ogiltigt nummer' });
          continue;
        }
        
        await updateAlgorithmConfigValue(update.key, numValue);
        results.push({ key: update.key, success: true });
      } catch (err: any) {
        results.push({ key: update.key, success: false, error: err.message });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    
    console.log(`✅ Batch-uppdatering: ${successCount}/${updates.length} lyckades`);
    res.json({
      success: successCount === updates.length,
      message: `${successCount} av ${updates.length} uppdateringar lyckades`,
      results: results,
    });
  } catch (error: any) {
    console.error('Error batch updating config:', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte uppdatera konfiguration',
      details: error.message,
    });
  }
});

/**
 * DELETE /api/admin/config/legacy-engine
 * Ta bort legacy motorval-konfiguration (USE_V5, USE_V6, USE_V7)
 */
app.delete('/api/admin/config/legacy-engine', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const deletedCount = await deleteLegacyEngineConfig();
    
    res.json({
      success: true,
      message: `Tog bort ${deletedCount} legacy motorval-konfigurationer`,
      deletedKeys: ['USE_V5', 'USE_V6', 'USE_V7'].slice(0, deletedCount),
    });
  } catch (error: any) {
    console.error('Error deleting legacy engine config:', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte ta bort legacy konfiguration',
      details: error.message,
    });
  }
});

export default app;
