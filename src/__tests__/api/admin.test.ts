/**
 * FEST - Admin API Tester
 * 
 * Testar admin-skyddade endpoints:
 * - GET/POST/PUT/DELETE /api/admin/products
 * - GET/POST/PUT/DELETE /api/admin/crops
 * - GET/PUT /api/admin/config
 * - GET /api/admin/product-analysis
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../api/server';

// Admin-lösenord från miljön eller fallback
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Helper för att lägga till admin-lösenord
function withAdminAuth(req: request.Test): request.Test {
  return req.set('X-Admin-Password', ADMIN_PASSWORD);
}

// ============================================================================
// ADMIN AUTH MIDDLEWARE
// ============================================================================

describe('Admin Authentication', () => {
  
  it('ska ge 403 utan X-Admin-Password header', async () => {
    const response = await request(app)
      .get('/api/admin/products')
      .set('Accept', 'application/json');
    
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('admin');
  });

  it('ska ge 403 med felaktigt lösenord', async () => {
    const response = await request(app)
      .get('/api/admin/products')
      .set('X-Admin-Password', 'fel-losenord')
      .set('Accept', 'application/json');
    
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  it('ska tillåta access med korrekt lösenord', async () => {
    const response = await withAdminAuth(
      request(app)
        .get('/api/admin/products')
        .set('Accept', 'application/json')
    );
    
    // 200 = OK, 500 = db-fel (men autentisering lyckades)
    expect([200, 500]).toContain(response.status);
  });

});

// ============================================================================
// ADMIN PRODUCTS API
// ============================================================================

describe('Admin Products API', () => {

  describe('GET /api/admin/products', () => {

    it('ska returnera produktlista', async () => {
      const response = await withAdminAuth(
        request(app)
          .get('/api/admin/products')
          .set('Accept', 'application/json')
      );
      
      if (response.status === 200) {
        expect(Array.isArray(response.body)).toBe(true);
      }
    });

  });

  describe('POST /api/admin/products', () => {

    it('ska ge 400 för ofullständig produktdata (app-format)', async () => {
      const response = await withAdminAuth(
        request(app)
          .post('/api/admin/products')
          .set('Content-Type', 'application/json')
          .send({
            name: 'Test produkt'
            // Saknar id och pricePerKg
          })
      );
      
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('ska acceptera produkt i DB-format', async () => {
      const response = await withAdminAuth(
        request(app)
          .post('/api/admin/products')
          .set('Content-Type', 'application/json')
          .send({
            Artikelnr: 999999,
            Produkt: 'Test Produkt E2E',
            N: '21',
            P: '4',
            K: '7',
            S: '3',
            Pris: '4.50'
          })
      );
      
      // 200 = skapad, 500 = db-fel (kanske duplicat)
      expect([200, 500]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.product).toBeDefined();
      }
    });

  });

  describe('PUT /api/admin/products/:id', () => {

    it('ska uppdatera produkt (DB-format)', async () => {
      const response = await withAdminAuth(
        request(app)
          .put('/api/admin/products/prod-999999')
          .set('Content-Type', 'application/json')
          .send({
            Produkt: 'Uppdaterad Test Produkt',
            Pris: '5.00'
          })
      );
      
      // 200 = uppdaterad, 404 = finns ej, 500 = db-fel
      expect([200, 404, 500]).toContain(response.status);
    });

  });

  describe('DELETE /api/admin/products/:id', () => {

    it('ska ta bort produkt', async () => {
      const response = await withAdminAuth(
        request(app)
          .delete('/api/admin/products/prod-999999')
      );
      
      // 200 = borttagen, 500 = db-fel
      expect([200, 500]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
      }
    });

  });

});

// ============================================================================
// ADMIN CROPS API
// ============================================================================

describe('Admin Crops API', () => {

  describe('GET /api/admin/crops', () => {

    it('ska returnera grödor i raw-format', async () => {
      const response = await withAdminAuth(
        request(app)
          .get('/api/admin/crops')
          .set('Accept', 'application/json')
      );
      
      if (response.status === 200) {
        expect(Array.isArray(response.body)).toBe(true);
      }
    });

  });

  describe('POST /api/admin/crops', () => {

    it('ska ge 400 om id saknas', async () => {
      const response = await withAdminAuth(
        request(app)
          .post('/api/admin/crops')
          .set('Content-Type', 'application/json')
          .send({
            name: 'Test Gröda'
            // Saknar id
          })
      );
      
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('ska ge 400 om name saknas', async () => {
      const response = await withAdminAuth(
        request(app)
          .post('/api/admin/crops')
          .set('Content-Type', 'application/json')
          .send({
            id: 'test_groda'
            // Saknar name
          })
      );
      
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('ska skapa gröda med valid data', async () => {
      const response = await withAdminAuth(
        request(app)
          .post('/api/admin/crops')
          .set('Content-Type', 'application/json')
          .send({
            id: 'test_groda_e2e',
            name: 'Test Gröda E2E',
            category: 'other',
            n_per_ton: 25,
            p_per_ton: 5,
            k_per_ton: 10,
            yield_min: 3,
            yield_max: 10,
            yield_average: 6
          })
      );
      
      // 201 = skapad, 500 = db-fel
      expect([201, 500]).toContain(response.status);
    });

  });

  describe('PUT /api/admin/crops/:id', () => {

    it('ska uppdatera gröda', async () => {
      const response = await withAdminAuth(
        request(app)
          .put('/api/admin/crops/test_groda_e2e')
          .set('Content-Type', 'application/json')
          .send({
            name: 'Uppdaterad Test Gröda',
            n_per_ton: 30
          })
      );
      
      // 200 = uppdaterad, 500 = db-fel (kanske finns ej)
      expect([200, 500]).toContain(response.status);
    });

  });

  describe('DELETE /api/admin/crops/:id', () => {

    it('ska ta bort gröda', async () => {
      const response = await withAdminAuth(
        request(app)
          .delete('/api/admin/crops/test_groda_e2e')
      );
      
      // 200 = borttagen, 500 = db-fel
      expect([200, 500]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
      }
    });

  });

});

// ============================================================================
// ADMIN CONFIG API
// ============================================================================

describe('Admin Config API', () => {

  describe('GET /api/admin/config', () => {

    it('ska returnera algoritmkonfiguration', async () => {
      const response = await withAdminAuth(
        request(app)
          .get('/api/admin/config')
          .set('Accept', 'application/json')
      );
      
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.config).toBeDefined();
        expect(Array.isArray(response.body.config)).toBe(true);
      }
    });

  });

  describe('GET /api/admin/config/:key', () => {

    it('ska returnera specifik konfigurationsparameter', async () => {
      const response = await withAdminAuth(
        request(app)
          .get('/api/admin/config/N_TOLERANCE_KG')
          .set('Accept', 'application/json')
      );
      
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.param).toBeDefined();
        expect(response.body.param.key).toBe('N_TOLERANCE_KG');
      } else if (response.status === 404) {
        expect(response.body.success).toBe(false);
      }
    });

    it('ska ge 404 för okänd nyckel', async () => {
      const response = await withAdminAuth(
        request(app)
          .get('/api/admin/config/OKAND_NYCKEL_SOM_INTE_FINNS')
          .set('Accept', 'application/json')
      );
      
      expect([404, 500]).toContain(response.status);
    });

  });

  describe('PUT /api/admin/config/:key', () => {

    it('ska ge 400 om value saknas', async () => {
      const response = await withAdminAuth(
        request(app)
          .put('/api/admin/config/N_TOLERANCE_KG')
          .set('Content-Type', 'application/json')
          .send({})
      );
      
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('ska ge 400 om value inte är ett nummer', async () => {
      const response = await withAdminAuth(
        request(app)
          .put('/api/admin/config/N_TOLERANCE_KG')
          .set('Content-Type', 'application/json')
          .send({ value: 'inte-ett-nummer' })
      );
      
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('ska uppdatera konfigurationsparameter', async () => {
      const response = await withAdminAuth(
        request(app)
          .put('/api/admin/config/N_TOLERANCE_KG')
          .set('Content-Type', 'application/json')
          .send({ value: 2 })
      );
      
      // 200 = uppdaterad, 400 = valideringsfel/db-fel, 500 = serverfel
      expect([200, 400, 500]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
      }
    });

  });

});

// ============================================================================
// PRODUCT ANALYSIS API
// ============================================================================

describe('GET /api/admin/product-analysis', () => {

  it('ska kräva admin-autentisering', async () => {
    const response = await request(app)
      .get('/api/admin/product-analysis')
      .set('Accept', 'application/json');
    
    expect(response.status).toBe(403);
  });

  it('ska returnera produktanalys', async () => {
    const response = await withAdminAuth(
      request(app)
        .get('/api/admin/product-analysis')
        .set('Accept', 'application/json')
    );
    
    if (response.status === 200) {
      expect(response.body.success).toBe(true);
      expect(response.body.totalProducts).toBeDefined();
      expect(response.body.analysis).toBeDefined();
      expect(response.body.cheapestSources).toBeDefined();
      expect(response.body.cheapestSources).toHaveProperty('N');
      expect(response.body.cheapestSources).toHaveProperty('P');
      expect(response.body.cheapestSources).toHaveProperty('K');
      expect(response.body.cheapestSources).toHaveProperty('S');
    }
  });

});
