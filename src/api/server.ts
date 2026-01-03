/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 */

import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import log from '../utils/logger';
import { calculateNutrientNeed, calculateNutrientNeedWithPrecrop } from '../data/crops';
import type { RecommendOptions } from '../engine/recommend';
import { recommend } from '../engine/recommend';
import type { OptimizeV7Input } from '../engine/optimize-v7';
import { optimizeV7 } from '../engine/optimize-v7';
import type { NutrientNeed } from '../models/NutrientNeed';
import { 
  validateBody,
  RecommendRequestSchema,
  OptimizeV7APIRequestSchema,
  generateInputWarnings,
  type RecommendRequest,
  type OptimizeV7APIRequest,
} from './validation';
import type { DBProduct } from './supabase';
import { 
  supabase,
  supabaseAdmin,
  PRODUCTS_TABLE, 
  dbProductToProduct, 
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

// Trust proxy for Railway/production (needed for rate-limiting and X-Forwarded-For)
if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT) {
  app.set('trust proxy', 1);
}

/** Helper to extract error message from unknown error */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Admin password from environment - required in production
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD && process.env.NODE_ENV === 'production') {
  log.error('ADMIN_PASSWORD måste sättas i produktion');
  process.exit(1);
}
// I development: fallback till test-lösenord med varning
if (!ADMIN_PASSWORD) {
  log.warn('ADMIN_PASSWORD ej satt - använder "admin123" (endast för utveckling)');
}
const EFFECTIVE_ADMIN_PASSWORD = ADMIN_PASSWORD || 'admin123';

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
  log.startup(`${API_KEYS.size} API-nyckel(ar) konfigurerade`);
} else {
  log.warn('Inga API-nycklar konfigurerade - externt API-åtkomst är öppen');
}

// Simple password check middleware for admin
function requireAdminPassword(req: Request, res: Response, next: NextFunction) {
  const password = req.headers['x-admin-password'];
  
  if (password === EFFECTIVE_ADMIN_PASSWORD) {
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
  // or come with X-Requested-With: XMLHttpRequest header from our JS
  const referer = req.headers['referer'] as string;
  const origin = req.headers['origin'] as string;
  const host = req.headers['host'] as string;
  const xRequestedWith = req.headers['x-requested-with'] as string;
  
  // If X-Requested-With header is set, it's from our frontend JS
  if (xRequestedWith === 'XMLHttpRequest') {
    return next();
  }
  
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

// =============================================================================
// RATE LIMITING
// =============================================================================

// General API rate limiter (more permissive)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuter
  max: 100, // max 100 requests per 15 min per IP
  message: {
    success: false,
    error: 'För många förfrågningar. Försök igen om 15 minuter.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});

// Stricter rate limiter for expensive operations (optimization)
const optimizeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minut
  max: 10, // max 10 optimeringar per minut per IP
  message: {
    success: false,
    error: 'För många optimeringsförfrågningar. Försök igen om en minut.',
    code: 'OPTIMIZE_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Admin rate limiter (prevent brute force)
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuter
  max: 30, // max 30 admin requests per 15 min per IP
  message: {
    success: false,
    error: 'För många admin-förfrågningar. Försök igen senare.',
    code: 'ADMIN_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// =============================================================================
// GLOBAL MIDDLEWARE
// =============================================================================

// Security headers with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-eval'"], // unsafe-eval needed for Swagger UI
      scriptSrcAttr: ["'none'"], // No inline event handlers allowed
      styleSrc: ["'self'", "'unsafe-inline'"], // Needed for Swagger UI inline styles
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow embedding for Swagger UI
}));

// CORS - Konfigurerad med vitlistade domäner
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
  : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000'];

// Add Railway domain automatically if running on Railway
if (process.env.RAILWAY_PUBLIC_DOMAIN) {
  allowedOrigins.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
}

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Tillåt requests utan origin (same-origin, server-to-server, Postman, etc.)
    if (!origin) {
      return callback(null, true);
    }
    // Kontrollera om origin finns i vitlistan
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    // I production, tillåt Railway domains
    if (origin.endsWith('.up.railway.app')) {
      return callback(null, true);
    }
    // I development-läge, tillåt alla localhost-varianter
    if (process.env.NODE_ENV !== 'production' && (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1'))) {
      return callback(null, true);
    }
    log.warn('CORS blockad för origin', { origin, allowedOrigins });
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Password', 'X-API-Key', 'X-Requested-With', 'X-Webhook-Secret'],
};

app.use(cors(corsOptions));

// JSON body parser
app.use(express.json());

// Apply general rate limiter to all API routes
app.use('/api/', apiLimiter);

// Apply stricter rate limiter to optimization endpoints
app.use('/api/recommend', optimizeLimiter);
app.use('/api/optimize-v7', optimizeLimiter);

// Apply admin rate limiter
app.use('/api/admin/', adminLimiter);

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
    log.startup('Swagger UI (extern) available at /api-docs');
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
    log.startup('Swagger UI (intern) available at /api-docs-internal');
  }
} catch (err) {
  log.warn('Could not load OpenAPI spec for Swagger UI', { error: err });
}

// Public static files with cache control
app.use(express.static(path.join(__dirname, '../../public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // Disable cache for JS files to ensure latest code
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

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
 * Kräver API-nyckel för extern åtkomst (om konfigurerat)
 * Validering sker via Zod-schema
 */
app.post('/api/recommend', requireApiKey, validateBody(RecommendRequestSchema), async (req: Request, res: Response) => {
  try {
    // Body är nu validerad och typkontrollerad via Zod
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

  // Hämta produkter från Supabase (behovsstyrt urval för bättre träffbild)
  let products = await getProductsForRecommendation(need as NutrientNeed, strategy);
  
  // Se till att tvingade produkter alltid är med i urvalet
  if (requiredProductIds && Array.isArray(requiredProductIds) && requiredProductIds.length > 0) {
    const productIdSet = new Set(products.map(p => p.id));
    const missingRequired = requiredProductIds.filter(id => !productIdSet.has(id));
    
    if (missingRequired.length > 0) {
      // Hämta alla produkter för att kunna lägga till de som saknas
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

    // Hämta algoritmkonfiguration från databasen
    let algorithmConfig;
    try {
      algorithmConfig = await getAlgorithmConfigMap();
      log.debug('Algoritmkonfiguration laddad för /recommend');
    } catch (configErr) {
      log.warn('Kunde inte ladda algoritmkonfiguration, använder defaults', { error: configErr });
      // Fortsätt med defaults om config inte kan laddas
    }

    // Kör rekommendationsmotor med användarens val av maxProducts.
    const options: RecommendOptions = {
      strategy,
      maxProducts: maxProducts as 1 | 2 | 3 | 4 | 5,
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
app.post('/api/optimize-v7', blockExternalAccess, validateBody(OptimizeV7APIRequestSchema), async (req: Request, res: Response) => {
  try {
    // Body är nu validerad och typkontrollerad via Zod
    const validatedData = req.body as OptimizeV7APIRequest;
    const { targets, mustFlags, maxProducts, minDose, maxDose } = validatedData;

    log.request('POST', '/api/optimize-v7', { targets, mustFlags, maxProducts, minDose, maxDose });

    // Hämta alla produkter
    const products = await getAllProductsForRecommendation();
    
    if (products.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Inga produkter tillgängliga för optimering',
      });
    }

    log.optimize(`V7-optimering med ${products.length} produkter`);

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
      maxProductsUser: maxProducts,
      minDoseKgHa: minDose,
      maxDoseKgHa: maxDose,
    };

    // Hämta algoritmkonfiguration från databasen
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
 * Returnera alla tillgängliga grödor från Supabase
 * Tillgänglig för externa API-anrop (endast läsning)
 */
app.get('/api/crops', requireApiKey, async (req: Request, res: Response) => {
  try {
    const category = req.query.category as string | undefined;
    const validCategories = ['spannmal', 'oljevaxte', 'rotfrukter', 'grovfoder', 'ovriga'] as const;
    type CropCategory = typeof validCategories[number];
    
    let crops;
    if (category && validCategories.includes(category as CropCategory)) {
      crops = await getCropsByCategory(category as CropCategory);
    } else if (category) {
      // Invalid category - return all crops with a warning
      crops = await getAllCrops();
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
    
    // Debug logging
    log.debug('calculate-need request', { cropId, yieldTonPerHa, precropId, body: req.body });

    if (!cropId || !yieldTonPerHa) {
      log.warn('calculate-need missing params', { cropId, yieldTonPerHa });
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
    log.error('Error in /api/calculate-need', { error, body: req.body });
    res.status(500).json({
      success: false,
      error: 'Serverfel vid beräkning av näringsbehov',
      details: error instanceof Error ? error.message : String(error),
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
      log.error('Supabase error fetching products', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch products from database',
        details: getErrorMessage(error),
      });
    }

    // Return raw database data (no transformation)
    res.json(data || []);
  } catch (error) {
    log.error('Server error in admin products', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: getErrorMessage(error),
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
    let dbProduct: Partial<DBProduct>;
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
      log.error('Supabase error', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to add product to database',
        details: getErrorMessage(error),
      });
    }

    res.json({
      success: true,
      message: 'Product added successfully',
      product: dbProductToProduct(data),
    });
  } catch (error) {
    log.error('Server error', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: getErrorMessage(error),
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
    let dbProduct: Partial<DBProduct>;
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
      log.error('Supabase error', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to update product in database',
        details: getErrorMessage(error),
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
  } catch (error) {
    log.error('Server error', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: getErrorMessage(error),
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
      log.error('Supabase error', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to delete product from database',
        details: getErrorMessage(error),
      });
    }

    res.json({
      success: true,
      message: 'Product deleted successfully',
      productId: id,
    });
  } catch (error) {
    log.error('Server error', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: getErrorMessage(error),
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
      log.security('M3 webhook: No M3_WEBHOOK_SECRET configured');
      return res.status(503).json({
        success: false,
        error: 'Webhook not configured',
        code: 'WEBHOOK_NOT_CONFIGURED'
      });
    }

    if (!webhookSecret || webhookSecret !== M3_WEBHOOK_SECRET) {
      log.security('M3 webhook: Invalid or missing secret');
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

  } catch (error) {
    log.error('M3 webhook error', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: getErrorMessage(error)
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

  } catch (error) {
    log.error('Product analysis error', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze products',
      details: getErrorMessage(error),
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
  } catch (error) {
    log.error('Error fetching crops', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte hämta grödor',
      details: getErrorMessage(error),
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
    
    log.info('Gröda skapad', { name: newCrop.name });
    res.status(201).json(newCrop);
  } catch (error) {
    log.error('Error creating crop', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte skapa gröda',
      details: getErrorMessage(error),
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
    
    log.info('Gröda uppdaterad', { cropId });
    res.json(updatedCrop);
  } catch (error) {
    log.error('Error updating crop', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte uppdatera gröda',
      details: getErrorMessage(error),
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
    
    log.info('Gröda borttagen', { cropId });
    res.json({ success: true, message: 'Gröda borttagen' });
  } catch (error) {
    log.error('Error deleting crop', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte ta bort gröda',
      details: getErrorMessage(error),
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
    const supabaseModule = await import('./supabase');
    const config = await supabaseModule.getAlgorithmConfig();
    
    res.json({
      success: true,
      count: config.length,
      config: config,
    });
  } catch (error) {
    log.error('Error fetching algorithm config', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte hämta algoritmkonfiguration',
      details: getErrorMessage(error),
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
  } catch (error) {
    log.error('Error fetching config param', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte hämta konfigurationsparameter',
      details: getErrorMessage(error),
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
    
    log.info('Konfiguration uppdaterad', { key, value: numValue });
    res.json({
      success: true,
      message: `Konfiguration uppdaterad: ${key} = ${numValue}`,
      param: param,
    });
  } catch (error) {
    log.error('Error updating config', error);
    res.status(400).json({
      success: false,
      error: getErrorMessage(error) || 'Kunde inte uppdatera konfiguration',
    });
  }
});

/**
 * POST /api/admin/config/batch
 * Update multiple configuration parameters at once
 */
app.post('/api/admin/config/batch', requireAdminPassword, async (req: Request, res: Response) => {
  try {
    const { updateAlgorithmConfigValue } = await import('./supabase');
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
      } catch (err) {
        results.push({ key: update.key, success: false, error: getErrorMessage(err) });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    
    log.info('Batch-uppdatering klar', { successCount, total: updates.length });
    res.json({
      success: successCount === updates.length,
      message: `${successCount} av ${updates.length} uppdateringar lyckades`,
      results: results,
    });
  } catch (error) {
    log.error('Error batch updating config', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte uppdatera konfiguration',
      details: getErrorMessage(error),
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
  } catch (error) {
    log.error('Error deleting legacy engine config', error);
    res.status(500).json({
      success: false,
      error: 'Kunde inte ta bort legacy konfiguration',
      details: getErrorMessage(error),
    });
  }
});

export default app;
