/**
 * FEST - Authentication Middleware
 * Admin password and API key verification
 */

import type { Request, Response, NextFunction } from 'express';
import log from '../../utils/logger';

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

// API Keys for external access (comma-separated in env)
const API_KEYS = new Set(
  (process.env.API_KEYS || '')
    .split(',')
    .map(key => key.trim())
    .filter(key => key.length > 0)
);

if (API_KEYS.size > 0) {
  log.info(`🚀 ${API_KEYS.size} API-nyckel(ar) konfigurerade`);
}

/**
 * Admin password middleware
 * Validates X-Admin-Password header
 */
export function requireAdminPassword(req: Request, res: Response, next: NextFunction) {
  const password = req.headers['x-admin-password'];
  
  if (!password) {
    return res.status(401).json({
      success: false,
      error: 'Admin-lösenord saknas'
    });
  }
  
  if (password !== EFFECTIVE_ADMIN_PASSWORD) {
    return res.status(403).json({
      success: false,
      error: 'Felaktigt admin-lösenord'
    });
  }
  
  next();
}

/**
 * API Key middleware for external API access
 * Checks X-API-Key header against configured keys
 * If no keys are configured, access is open (for development)
 * Same-origin requests (from our frontend) are allowed without API key
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  // If no API keys configured, allow access (development mode)
  if (API_KEYS.size === 0) {
    return next();
  }

  // Check if request is from same origin (our frontend)
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
  // check if it looks like a browser request
  const accept = req.headers['accept'] as string;
  const apiKey = req.headers['x-api-key'] as string;
  
  // If no API key provided and request accepts HTML, it might be browser navigation
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
export function blockExternalAccess(req: Request, res: Response, next: NextFunction) {
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

/** Get the effective admin password (for testing) */
export function getEffectiveAdminPassword(): string {
  return EFFECTIVE_ADMIN_PASSWORD;
}
