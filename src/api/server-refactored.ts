/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 * 
 * Refactored server with modular routes
 */

import type { Request, Response } from 'express';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import log from '../utils/logger';

// Middleware
import { apiLimiter, optimizeLimiter, adminLimiter } from './middleware';

// Routes
import {
  publicRoutes,
  adminProductsRoutes,
  adminCropsRoutes,
  adminConfigRoutes,
  adminAnalysisRoutes,
  webhookRoutes,
  healthRoutes,
} from './routes';

// Load environment variables
dotenv.config();

const app = express();

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

// Apply rate limiters
app.use('/api/', apiLimiter);
app.use('/api/recommend', optimizeLimiter);
app.use('/api/optimize-v7', optimizeLimiter);
app.use('/api/admin/', adminLimiter);

// =============================================================================
// SWAGGER UI - API DOCUMENTATION
// =============================================================================

try {
  // External API docs (for partners)
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

// =============================================================================
// STATIC FILES
// =============================================================================

app.use(express.static(path.join(__dirname, '../../public')));

app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

// =============================================================================
// API ROUTES
// =============================================================================

// Public API routes
app.use('/api', publicRoutes);

// Health check
app.use('/health', healthRoutes);

// Webhook routes
app.use('/api/webhook', webhookRoutes);

// Admin routes
app.use('/api/admin/products', adminProductsRoutes);
app.use('/api/admin/crops', adminCropsRoutes);
app.use('/api/admin/config', adminConfigRoutes);
app.use('/api/admin/product-analysis', adminAnalysisRoutes);

export default app;
