/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 */

/**
 * Centraliserad logger med Winston
 * 
 * Funktioner:
 * - Strukturerade loggar i JSON-format för produktion
 * - Färgade, läsbara loggar för utveckling
 * - Olika log-nivåer (error, warn, info, debug)
 * - Request ID tracking (för framtida correlation)
 */

import winston from 'winston';

const { combine, timestamp, printf, colorize, json } = winston.format;

// Avgör om vi kör i produktion
const isProduction = process.env.NODE_ENV === 'production';

// Custom format för utveckling (läsbar)
const devFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  
  // Lägg till metadata om det finns
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  
  return msg;
});

// Skapa logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    isProduction ? json() : combine(colorize(), devFormat)
  ),
  defaultMeta: { service: 'fest-api' },
  transports: [
    new winston.transports.Console(),
  ],
});

// Convenience methods med emoji för visuell feedback i dev
export const log = {
  /**
   * Informationsmeddelanden
   */
  info: (message: string, meta?: Record<string, any>) => {
    logger.info(message, meta);
  },

  /**
   * Varningar
   */
  warn: (message: string, meta?: Record<string, any>) => {
    logger.warn(message, meta);
  },

  /**
   * Fel
   */
  error: (message: string, error?: Error | unknown, meta?: Record<string, any>) => {
    const errorMeta = error instanceof Error 
      ? { error: error.message, stack: error.stack, ...meta }
      : { error: String(error), ...meta };
    logger.error(message, errorMeta);
  },

  /**
   * Debug (visas bara om LOG_LEVEL=debug)
   */
  debug: (message: string, meta?: Record<string, any>) => {
    logger.debug(message, meta);
  },

  /**
   * Startup-meddelanden (alltid synliga)
   */
  startup: (message: string) => {
    logger.info(`🚀 ${message}`);
  },

  /**
   * API request logging
   */
  request: (method: string, path: string, meta?: Record<string, any>) => {
    logger.info(`📥 ${method} ${path}`, { type: 'request', ...meta });
  },

  /**
   * API response logging
   */
  response: (method: string, path: string, statusCode: number, durationMs: number) => {
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    logger[level](`📤 ${method} ${path} ${statusCode}`, { 
      type: 'response', 
      statusCode, 
      durationMs 
    });
  },

  /**
   * Optimization-specifik logging
   */
  optimize: (message: string, meta?: Record<string, any>) => {
    logger.info(`⚙️ ${message}`, { type: 'optimization', ...meta });
  },

  /**
   * Database operations
   */
  db: (message: string, meta?: Record<string, any>) => {
    logger.debug(`🗄️ ${message}`, { type: 'database', ...meta });
  },

  /**
   * Security events
   */
  security: (message: string, meta?: Record<string, any>) => {
    logger.warn(`🔐 ${message}`, { type: 'security', ...meta });
  },
};

// Export raw winston logger för avancerade användningsfall
export { logger };

export default log;
