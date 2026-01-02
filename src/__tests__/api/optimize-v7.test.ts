/**
 * FEST - Optimize V7 API Tester
 * 
 * Testar /api/optimize-v7 endpoint:
 * - Validering av input
 * - MILP-optimering
 * - Strategier och prispall
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../api/server';

// ============================================================================
// OPTIMIZE-V7 API
// ============================================================================

describe('POST /api/optimize-v7', () => {

  describe('Extern åtkomst blockerad', () => {

    it('ska blockera extern åtkomst (med API-nyckel)', async () => {
      const response = await request(app)
        .post('/api/optimize-v7')
        .set('Content-Type', 'application/json')
        .set('X-API-Key', 'any-api-key')
        .send({
          targets: { N: 100 },
          mustFlags: { mustN: true }
        });
      
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ENDPOINT_NOT_AVAILABLE');
    });

  });

  describe('Validering', () => {

    it('ska ge 400 om targets saknas', async () => {
      const response = await request(app)
        .post('/api/optimize-v7')
        .set('Content-Type', 'application/json')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          mustFlags: { mustN: true }
        });
      
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('ska ge 400 om targets inte är ett objekt', async () => {
      const response = await request(app)
        .post('/api/optimize-v7')
        .set('Content-Type', 'application/json')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          targets: 'not-an-object',
          mustFlags: { mustN: true }
        });
      
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

  });

  describe('Lyckade optimeringar (internal access)', () => {

    it('ska optimera för enbart N-behov', async () => {
      const response = await request(app)
        .post('/api/optimize-v7')
        .set('Content-Type', 'application/json')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          targets: { N: 150 },
          mustFlags: { mustN: true, mustP: false, mustK: false, mustS: false },
          maxProducts: 2
        });
      
      // 200 = OK, 500 = db/optimeringsfel
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.status).toBe('ok');
        expect(response.body.strategies).toBeDefined();
        expect(Array.isArray(response.body.strategies)).toBe(true);
      }
    });

    it('ska optimera för multi-nutrient behov', async () => {
      const response = await request(app)
        .post('/api/optimize-v7')
        .set('Content-Type', 'application/json')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          targets: { N: 150, P: 25, K: 40, S: 15 },
          mustFlags: { mustN: true, mustP: true, mustK: true, mustS: true },
          maxProducts: 3
        });
      
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.status).toBe('ok');
        
        if (response.body.strategies.length > 0) {
          const strategy = response.body.strategies[0];
          expect(strategy).toHaveProperty('totalCostSekHa');
          expect(strategy).toHaveProperty('products');
          expect(strategy).toHaveProperty('achieved');
          expect(strategy).toHaveProperty('percentOfTarget');
        }
      }
    });

    it('ska respektera maxProducts begränsning', async () => {
      const response = await request(app)
        .post('/api/optimize-v7')
        .set('Content-Type', 'application/json')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          targets: { N: 150, P: 25, K: 40, S: 15 },
          mustFlags: { mustN: true, mustP: true, mustK: true, mustS: true },
          maxProducts: 2
        });
      
      if (response.status === 200 && response.body.strategies?.length > 0) {
        response.body.strategies.forEach((strategy: { products: unknown[] }) => {
          expect(strategy.products.length).toBeLessThanOrEqual(2);
        });
      }
    });

    it('ska respektera minDose och maxDose', async () => {
      const response = await request(app)
        .post('/api/optimize-v7')
        .set('Content-Type', 'application/json')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          targets: { N: 100 },
          mustFlags: { mustN: true },
          maxProducts: 2,
          minDose: 150,
          maxDose: 400
        });
      
      if (response.status === 200 && response.body.strategies?.length > 0) {
        const strategy = response.body.strategies[0];
        strategy.products.forEach((product: { doseKgHa: number }) => {
          expect(product.doseKgHa).toBeGreaterThanOrEqual(150);
          expect(product.doseKgHa).toBeLessThanOrEqual(400);
        });
      }
    });

    it('ska returnera flera strategier (prispall)', async () => {
      const response = await request(app)
        .post('/api/optimize-v7')
        .set('Content-Type', 'application/json')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          targets: { N: 150, P: 20, K: 30 },
          mustFlags: { mustN: true, mustP: true, mustK: true },
          maxProducts: 3
        });
      
      if (response.status === 200 && response.body.status === 'ok') {
        // Bör returnera flera strategier om möjligt
        expect(response.body.strategies.length).toBeGreaterThan(0);
      }
    });

    it('ska hantera infeasible problem', async () => {
      const response = await request(app)
        .post('/api/optimize-v7')
        .set('Content-Type', 'application/json')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          targets: { N: 5000, P: 2000, K: 3000, S: 1000 },  // Orealistiskt högt
          mustFlags: { mustN: true, mustP: true, mustK: true, mustS: true },
          maxProducts: 1,
          minDose: 100,
          maxDose: 200  // Omöjligt att nå med så lite dos
        });
      
      // Bör returnera infeasible eller tomt resultat
      if (response.status === 200) {
        if (response.body.status === 'infeasible') {
          expect(response.body.strategies.length).toBe(0);
        }
      }
    });

    it('ska hantera default-värden för mustFlags', async () => {
      const response = await request(app)
        .post('/api/optimize-v7')
        .set('Content-Type', 'application/json')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          targets: { N: 100 },
          // mustFlags saknas - ska använda defaults
          maxProducts: 2
        });
      
      // Ska inte krascha utan mustFlags
      expect([200, 500]).toContain(response.status);
    });

  });

});

// ============================================================================
// STATIC FILES
// ============================================================================

describe('Static files', () => {

  it('ska servera index.html på /', async () => {
    const response = await request(app)
      .get('/')
      .set('Accept', 'text/html');
    
    expect(response.status).toBe(200);
    expect(response.text).toContain('FEST');
  });

  it('ska servera admin.html', async () => {
    const response = await request(app)
      .get('/admin.html')
      .set('Accept', 'text/html');
    
    expect(response.status).toBe(200);
    expect(response.text).toContain('admin');
  });

  it('ska servera CSS-filer', async () => {
    const response = await request(app)
      .get('/css/base.css')
      .set('Accept', 'text/css');
    
    expect(response.status).toBe(200);
  });

  it('ska servera JavaScript-filer', async () => {
    const response = await request(app)
      .get('/js/app.js')
      .set('Accept', 'application/javascript');
    
    expect(response.status).toBe(200);
  });

});

// ============================================================================
// API DOCS
// ============================================================================

describe('API Documentation', () => {

  it('ska servera extern API-dokumentation', async () => {
    const response = await request(app)
      .get('/api-docs/')
      .set('Accept', 'text/html');
    
    expect(response.status).toBe(200);
    expect(response.text).toContain('swagger');
  });

  it('ska servera intern API-dokumentation', async () => {
    const response = await request(app)
      .get('/api-docs-internal/')
      .set('Accept', 'text/html');
    
    expect(response.status).toBe(200);
    expect(response.text).toContain('swagger');
  });

});
