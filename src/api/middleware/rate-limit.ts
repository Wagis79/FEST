/**
 * FEST - Rate Limiting Middleware
 */

import rateLimit from 'express-rate-limit';

/**
 * General API rate limiter (more permissive)
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuter
  max: 100, // max 100 requests per 15 min per IP
  message: {
    success: false,
    error: 'För många förfrågningar. Försök igen om 15 minuter.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});

/**
 * Stricter rate limiter for expensive operations (optimization)
 */
export const optimizeLimiter = rateLimit({
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

/**
 * Admin rate limiter (prevent brute force)
 */
export const adminLimiter = rateLimit({
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
