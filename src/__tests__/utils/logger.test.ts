/**
 * FEST - Logger Tests
 * 
 * Testar logger-modulen och dess hjälpfunktioner.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import log from '../../utils/logger';

describe('Logger', () => {
  
  beforeEach(() => {
    // Mocka console för att förhindra spam
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Loggningsmetoder', () => {
    
    it('ska ha info-metod', () => {
      expect(typeof log.info).toBe('function');
      // Ska inte kasta fel
      expect(() => log.info('Test info')).not.toThrow();
    });

    it('ska ha warn-metod', () => {
      expect(typeof log.warn).toBe('function');
      expect(() => log.warn('Test warning')).not.toThrow();
    });

    it('ska ha error-metod', () => {
      expect(typeof log.error).toBe('function');
      expect(() => log.error('Test error')).not.toThrow();
    });

    it('ska ha debug-metod', () => {
      expect(typeof log.debug).toBe('function');
      expect(() => log.debug('Test debug')).not.toThrow();
    });

  });

  describe('Specialiserade loggningsmetoder', () => {
    
    it('ska ha startup-metod', () => {
      expect(typeof log.startup).toBe('function');
      expect(() => log.startup('Test startup log')).not.toThrow();
    });

    it('ska ha optimize-metod', () => {
      expect(typeof log.optimize).toBe('function');
      expect(() => log.optimize('Test optimize log')).not.toThrow();
    });

    it('ska ha db-metod', () => {
      expect(typeof log.db).toBe('function');
      expect(() => log.db('Test DB log')).not.toThrow();
    });

    it('ska ha security-metod', () => {
      expect(typeof log.security).toBe('function');
      expect(() => log.security('Test security log')).not.toThrow();
    });

  });

  describe('Request/Response logging', () => {
    
    it('ska ha request-metod', () => {
      expect(typeof log.request).toBe('function');
      expect(() => log.request('GET', '/api/test')).not.toThrow();
    });

    it('ska logga request med metadata', () => {
      expect(() => log.request('POST', '/api/recommend', { userId: '123' })).not.toThrow();
    });

    it('ska ha response-metod', () => {
      expect(typeof log.response).toBe('function');
    });

    it('ska logga response med 200 status', () => {
      expect(() => log.response('GET', '/api/test', 200, 50)).not.toThrow();
    });

    it('ska logga response med 400 status som varning', () => {
      expect(() => log.response('POST', '/api/recommend', 400, 10)).not.toThrow();
    });

    it('ska logga response med 500 status som error', () => {
      expect(() => log.response('POST', '/api/recommend', 500, 100)).not.toThrow();
    });

    it('ska logga response med 404 status som varning', () => {
      expect(() => log.response('GET', '/api/unknown', 404, 5)).not.toThrow();
    });

    it('ska logga response med 503 status som error', () => {
      expect(() => log.response('GET', '/health', 503, 1000)).not.toThrow();
    });

  });

  describe('Metadata stöd', () => {
    
    it('ska acceptera metadata i info', () => {
      expect(() => log.info('Test med meta', { key: 'value' })).not.toThrow();
    });

    it('ska acceptera metadata i error', () => {
      expect(() => log.error('Error med detaljer', { errorCode: 500 })).not.toThrow();
    });

    it('ska acceptera Error-objekt', () => {
      expect(() => log.error('Caught error', new Error('Test error'))).not.toThrow();
    });

  });

});
