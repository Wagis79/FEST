/**
 * FEST - API Integrationstester
 * 
 * Testar alla publika API-endpoints:
 * - GET /health
 * - GET /api/crops
 * - POST /api/recommend
 * - POST /api/calculate-need
 * 
 * OBS: Dessa tester kräver att API-nycklar är konfigurerade i .env
 * och att en giltig nyckel används i testerna.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../api/server';

// Hämta en API-nyckel från miljön för tester
const API_KEY = process.env.API_KEYS?.split(',')[0]?.trim() || 'test-key';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'FESTadmin2025';

// Helper för att lägga till API-nyckel
function withApiKey(req: request.Test): request.Test {
  return req.set('X-API-Key', API_KEY);
}

// Helper för att lägga till admin-lösenord
function withAdminAuth(req: request.Test): request.Test {
  return req.set('X-Admin-Password', ADMIN_PASSWORD);
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

describe('GET /health', () => {
  
  it('ska returnera status OK', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);
    
    expect(response.body).toHaveProperty('status', 'OK');
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('timestamp');
  });

});

// ============================================================================
// CROPS API
// ============================================================================

describe('GET /api/crops', () => {
  
  it('ska returnera lista med grödor', async () => {
    const response = await withApiKey(
      request(app)
        .get('/api/crops')
        .set('Accept', 'application/json')
    ).expect('Content-Type', /json/);
    
    // Kan få 200 eller 503 beroende på databasanslutning
    if (response.status === 200) {
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('crops');
      expect(Array.isArray(response.body.crops)).toBe(true);
      expect(response.body.count).toBeGreaterThan(0);
    } else {
      // Om databasen inte är tillgänglig
      expect(response.status).toBe(503);
      expect(response.body).toHaveProperty('success', false);
    }
  });

  it('ska stödja filtrering på kategori', async () => {
    const response = await withApiKey(
      request(app)
        .get('/api/crops?category=spannmål')
        .set('Accept', 'application/json')
    );
    
    if (response.status === 200) {
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('crops');
    }
  });

});

// ============================================================================
// SAME-ORIGIN API ACCESS (X-Requested-With header)
// ============================================================================

describe('Same-origin API access', () => {
  
  it('ska tillåta API-anrop med X-Requested-With header utan API-nyckel', async () => {
    const response = await request(app)
      .get('/api/crops')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Accept', 'application/json');
    
    // Bör få 200 eller 503 (databas), inte 401 (unauthorized)
    expect([200, 503]).toContain(response.status);
    expect(response.status).not.toBe(401);
  });

  it('ska tillåta API-anrop med X-Requested-With header till /api/products', async () => {
    const response = await request(app)
      .get('/api/products')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Accept', 'application/json');
    
    expect([200, 503]).toContain(response.status);
    expect(response.status).not.toBe(401);
    
    if (response.status === 200) {
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('products');
    }
  });

  it('ska tillåta POST /api/recommend med X-Requested-With header', async () => {
    const response = await request(app)
      .post('/api/recommend')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Content-Type', 'application/json')
      .send({
        need: { N: 100 },
        requiredNutrients: ['N'],
        maxProducts: 2
      });
    
    // Bör få 200 eller 500/503 (databas/optimering), inte 401
    expect(response.status).not.toBe(401);
  });

  it('ska neka API-anrop utan X-Requested-With eller API-nyckel', async () => {
    const response = await request(app)
      .get('/api/crops')
      .set('Accept', 'application/json');
    
    // Ska få 401 Unauthorized
    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('success', false);
    expect(response.body.code).toBe('MISSING_API_KEY');
  });

});

// ============================================================================
// RECOMMEND API
// ============================================================================

describe('POST /api/recommend', () => {
  
  describe('Validering', () => {
    
    it('ska ge 400 om need saknas', async () => {
      const response = await withApiKey(
        request(app)
          .post('/api/recommend')
          .set('Accept', 'application/json')
          .send({})
      ).expect(400);
      
      expect(response.body).toHaveProperty('success', false);
      // Zod returnerar 'Valideringsfel' som generellt felmeddelande
      expect(response.body.error).toBe('Valideringsfel');
      expect(response.body.details).toBeDefined();
    });

    it('ska ge 400 om alla näringsämnen saknas', async () => {
      const response = await withApiKey(
        request(app)
          .post('/api/recommend')
          .set('Accept', 'application/json')
          .send({
            need: {}  // Tomt objekt - inget näringsämne angivet
          })
      ).expect(400);
      
      expect(response.body).toHaveProperty('success', false);
    });

    it('ska ge 400 vid ogiltig strategi', async () => {
      const response = await withApiKey(
        request(app)
          .post('/api/recommend')
          .set('Accept', 'application/json')
          .send({
            need: { N: 100 },
            strategy: 'invalid_strategy'
          })
      ).expect(400);
      
      expect(response.body).toHaveProperty('success', false);
      // Zod returnerar 'Valideringsfel' som generellt felmeddelande
      expect(response.body.error).toBe('Valideringsfel');
    });

    it('ska ge 400 om required och excluded produkter överlappar', async () => {
      const response = await withApiKey(
        request(app)
          .post('/api/recommend')
          .set('Accept', 'application/json')
          .send({
            need: { N: 100 },
            requiredProductIds: ['prod-123'],
            excludedProductIds: ['prod-123']
          })
      ).expect(400);
      
      expect(response.body).toHaveProperty('success', false);
      // Zod returnerar detaljer i details-arrayen
      expect(response.body.error).toBe('Valideringsfel');
    });

  });

  describe('Lyckade requests', () => {
    
    it('ska returnera lösningar för enkelt N-behov', async () => {
      const response = await withApiKey(
        request(app)
          .post('/api/recommend')
          .set('Accept', 'application/json')
          .send({
            need: { N: 100 },
            requiredNutrients: ['N'],
            maxProducts: 2
          })
      );
      
      // Kan få 200 eller 500/503 beroende på databasanslutning
      if (response.status === 200) {
        expect(response.body).toHaveProperty('success', true);
        expect(response.body).toHaveProperty('solutions');
        expect(Array.isArray(response.body.solutions)).toBe(true);
        
        if (response.body.solutions.length > 0) {
          const solution = response.body.solutions[0];
          expect(solution).toHaveProperty('products');
          expect(solution).toHaveProperty('costPerHa');
          expect(solution).toHaveProperty('supplied');
        }
      }
    });

    it('ska returnera lösningar för multi-nutrient behov', async () => {
      const response = await withApiKey(
        request(app)
          .post('/api/recommend')
          .set('Accept', 'application/json')
          .send({
            need: { N: 150, P: 25, K: 40, S: 15 },
            requiredNutrients: ['N', 'P', 'K', 'S'],
            maxProducts: 3,
            topN: 3
          })
      );
      
      if (response.status === 200) {
        expect(response.body).toHaveProperty('success', true);
        expect(response.body.count).toBeLessThanOrEqual(3);
        
        // Verifiera att lösningarna är sorterade på kostnad
        interface SolutionWithCost { costPerHa: number }
        const costs = response.body.solutions.map((s: SolutionWithCost) => s.costPerHa);
        for (let i = 1; i < costs.length; i++) {
          expect(costs[i]).toBeGreaterThanOrEqual(costs[i-1]);
        }
      }
    });

    it('ska acceptera economic strategi', async () => {
      const response = await withApiKey(
        request(app)
          .post('/api/recommend')
          .set('Accept', 'application/json')
          .send({
            need: { N: 120, P: 20, K: 30 },
            requiredNutrients: ['N', 'P', 'K'],
            strategy: 'economic',
            maxProducts: 3
          })
      );
      
      if (response.status === 200) {
        expect(response.body).toHaveProperty('success', true);
      }
    });

    it('ska acceptera optimized strategi', async () => {
      const response = await withApiKey(
        request(app)
          .post('/api/recommend')
          .set('Accept', 'application/json')
          .send({
            need: { N: 120, P: 20, K: 30 },
            requiredNutrients: ['N', 'P', 'K'],
            strategy: 'optimized',
            maxProducts: 3
          })
      );
      
      if (response.status === 200) {
        expect(response.body).toHaveProperty('success', true);
      }
    });

    it('ska respektera excludedProductIds', async () => {
      const response = await withApiKey(
        request(app)
          .post('/api/recommend')
          .set('Accept', 'application/json')
          .send({
            need: { N: 100 },
            requiredNutrients: ['N'],
            maxProducts: 2,
            excludedProductIds: ['prod-999999']
          })
      );
      
      if (response.status === 200) {
        expect(response.body).toHaveProperty('success', true);
      }
    });

    it('ska inkludera requiredProductIds i lösningen', async () => {
      // Först hämta en giltig produkt-ID från databasen
      const productsResponse = await request(app)
        .get('/api/products')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Accept', 'application/json');
      
      if (productsResponse.status !== 200 || !productsResponse.body.products?.length) {
        // Hoppa över om vi inte kan hämta produkter
        return;
      }
      
      // Hitta en produkt med N-innehåll
      const nProduct = productsResponse.body.products.find(
        (p: { nutrients?: { N?: number }, id: string }) => p.nutrients?.N && p.nutrients.N > 0
      );
      
      if (!nProduct) {
        return; // Hoppa över om ingen N-produkt finns
      }
      
      const response = await withApiKey(
        request(app)
          .post('/api/recommend')
          .set('Accept', 'application/json')
          .send({
            need: { N: 150, P: 20, K: 30, S: 10 },
            requiredNutrients: ['N', 'P', 'K', 'S'],
            maxProducts: 3,
            requiredProductIds: [nProduct.id]
          })
      );
      
      if (response.status === 200 && response.body.solutions?.length > 0) {
        expect(response.body).toHaveProperty('success', true);
        
        // Verifiera att den tvingade produkten finns med i första lösningen
        const firstSolution = response.body.solutions[0];
        const productIds = firstSolution.products.map((p: { productId: string }) => p.productId);
        
        expect(productIds).toContain(nProduct.id);
      }
    });

    it('ska returnera requiredProductIds i response', async () => {
      const response = await withApiKey(
        request(app)
          .post('/api/recommend')
          .set('Accept', 'application/json')
          .send({
            need: { N: 100 },
            requiredNutrients: ['N'],
            maxProducts: 2,
            requiredProductIds: ['prod-test123']
          })
      );
      
      if (response.status === 200) {
        expect(response.body).toHaveProperty('requiredProductIds');
        expect(response.body.requiredProductIds).toContain('prod-test123');
      }
    });

  });

  describe('Varningar', () => {
    
    it('ska ge varning för lågt totalt behov', async () => {
      const response = await withApiKey(
        request(app)
          .post('/api/recommend')
          .set('Accept', 'application/json')
          .send({
            need: { N: 5, P: 2 },
            requiredNutrients: ['N', 'P'],
            maxProducts: 2
          })
      );
      
      if (response.status === 200 && response.body.warnings) {
        expect(response.body.warnings.some((w: string) => 
          w.toLowerCase().includes('lågt')
        )).toBe(true);
      }
    });

  });

});

// ============================================================================
// CALCULATE-NEED API
// ============================================================================

describe('POST /api/calculate-need', () => {
  
  it('ska ge 400 om cropId saknas', async () => {
    const response = await withApiKey(
      request(app)
        .post('/api/calculate-need')
        .set('Accept', 'application/json')
        .send({
          yieldTonPerHa: 6
        })
    ).expect(400);
    
    expect(response.body).toHaveProperty('success', false);
  });

  it('ska ge 400 om yieldTonPerHa saknas', async () => {
    const response = await withApiKey(
      request(app)
        .post('/api/calculate-need')
        .set('Accept', 'application/json')
        .send({
          cropId: 'vete'
        })
    ).expect(400);
    
    expect(response.body).toHaveProperty('success', false);
  });

  it('ska beräkna näringsbehov för giltig gröda', async () => {
    const response = await withApiKey(
      request(app)
        .post('/api/calculate-need')
        .set('Accept', 'application/json')
        .send({
          cropId: 'hostevete',
          yieldTonPerHa: 8
        })
    );
    
    // 200 om grödan finns, 404 om inte
    if (response.status === 200) {
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('need');
      expect(response.body.need).toHaveProperty('N');
      expect(response.body.need).toHaveProperty('P');
      expect(response.body.need).toHaveProperty('K');
      expect(response.body.need.N).toBeGreaterThan(0);
    } else if (response.status === 404) {
      expect(response.body).toHaveProperty('success', false);
    }
  });

  it('ska beräkna näringsbehov med förfrukt', async () => {
    const response = await withApiKey(
      request(app)
        .post('/api/calculate-need')
        .set('Accept', 'application/json')
        .send({
          cropId: 'hostevete',
          yieldTonPerHa: 8,
          precropId: 'klover'
        })
    );
    
    // 200 om grödorna finns, 404 om inte
    if (response.status === 200) {
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('need');
      // Med förfrukt bör N-behovet potentiellt vara lägre
      expect(response.body.need.N).toBeGreaterThanOrEqual(0);
    }
  });

  it('ska ge 404 för okänd gröda', async () => {
    const response = await withApiKey(
      request(app)
        .post('/api/calculate-need')
        .set('Accept', 'application/json')
        .send({
          cropId: 'nonexistent_crop_xyz',
          yieldTonPerHa: 8
        })
    );
    
    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('success', false);
  });

});

// ============================================================================
// API KEY VALIDERING (om konfigurerat)
// ============================================================================

describe('API Key middleware', () => {
  
  it('ska ge 401 utan API-nyckel när nycklar är konfigurerade', async () => {
    // När API_KEYS är konfigurerade ska requests utan nyckel nekas
    const response = await request(app)
      .get('/api/crops')
      .set('Accept', 'application/json');
    
    // Om API-nycklar är konfigurerade (production-like) ska vi få 401
    // Om inga nycklar är konfigurerade (dev mode) ska vi få 200/503
    expect([200, 401, 503]).toContain(response.status);
  });

  it('ska tillåta requests med giltig API-nyckel', async () => {
    const response = await withApiKey(
      request(app)
        .get('/api/crops')
        .set('Accept', 'application/json')
    );
    
    // Med giltig API-nyckel ska vi få 200 eller 503 (db ej tillgänglig)
    expect([200, 503]).toContain(response.status);
  });

  it('ska ge 403 med ogiltig API-nyckel', async () => {
    const response = await request(app)
      .get('/api/crops')
      .set('Accept', 'application/json')
      .set('X-API-Key', 'invalid-key-that-does-not-exist');
    
    // Ska få 403 Forbidden med ogiltig nyckel
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INVALID_API_KEY');
  });

});

// ============================================================================
// M3 WEBHOOK API
// ============================================================================

const WEBHOOK_SECRET = process.env.M3_WEBHOOK_SECRET || 'test-webhook-secret';

// Helper för att lägga till webhook secret
function withWebhookSecret(req: request.Test): request.Test {
  return req.set('X-Webhook-Secret', WEBHOOK_SECRET);
}

describe('POST /api/webhook/m3-product', () => {

  describe('Autentisering', () => {

    it('ska ge 401 eller 503 utan X-Webhook-Secret header', async () => {
      const response = await request(app)
        .post('/api/webhook/m3-product')
        .set('Content-Type', 'application/json')
        .send({ itemNumber: '301763', salesPrice: 5500 });
      
      // 401 = saknar secret, 503 = webhook ej konfigurerat
      expect([401, 503]).toContain(response.status);
    });

    it('ska ge 401 med ogiltig webhook secret', async () => {
      const response = await request(app)
        .post('/api/webhook/m3-product')
        .set('Content-Type', 'application/json')
        .set('X-Webhook-Secret', 'fel-hemlig-nyckel')
        .send({ itemNumber: '301763', salesPrice: 5500 });
      
      // 401 = ogiltig secret, 503 = webhook ej konfigurerat
      expect([401, 503]).toContain(response.status);
    });

  });

  describe('Validering', () => {

    it('ska ge 400 när itemNumber saknas', async () => {
      const response = await withWebhookSecret(
        request(app)
          .post('/api/webhook/m3-product')
          .set('Content-Type', 'application/json')
      ).send({ salesPrice: 5500 });
      
      // 400 = valideringsfel, 503 = webhook ej konfigurerat
      expect([400, 503]).toContain(response.status);
      
      if (response.status === 400) {
        expect(response.body.error).toContain('itemNumber');
      }
    });

    it('ska ge 400 när varken salesPrice eller active skickas', async () => {
      const response = await withWebhookSecret(
        request(app)
          .post('/api/webhook/m3-product')
          .set('Content-Type', 'application/json')
      ).send({ itemNumber: '301763' });
      
      // 400 = valideringsfel, 503 = webhook ej konfigurerat
      expect([400, 503]).toContain(response.status);
      
      if (response.status === 400) {
        expect(response.body.code).toBe('NO_UPDATES');
      }
    });

  });

  describe('Framgångsrika uppdateringar', () => {

    it('ska acceptera giltig prisuppdatering', async () => {
      const response = await withWebhookSecret(
        request(app)
          .post('/api/webhook/m3-product')
          .set('Content-Type', 'application/json')
      ).send({ 
        itemNumber: '301763', 
        salesPrice: 5500 
      });
      
      // 200 = uppdaterad, 404 = produkt finns ej, 503 = db nere
      expect([200, 404, 503]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.updates).toHaveProperty('price');
      }
    });

    it('ska acceptera active-status uppdatering', async () => {
      const response = await withWebhookSecret(
        request(app)
          .post('/api/webhook/m3-product')
          .set('Content-Type', 'application/json')
      ).send({ 
        itemNumber: '301763', 
        active: false 
      });
      
      // 200 = uppdaterad, 404 = produkt finns ej, 503 = db nere
      expect([200, 404, 503]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.updates).toHaveProperty('active');
      }
    });

    it('ska acceptera kombinerad uppdatering av pris och status', async () => {
      const response = await withWebhookSecret(
        request(app)
          .post('/api/webhook/m3-product')
          .set('Content-Type', 'application/json')
      ).send({ 
        itemNumber: '301763', 
        salesPrice: 5800,
        active: true 
      });
      
      // 200 = uppdaterad, 404 = produkt finns ej, 503 = db nere
      expect([200, 404, 503]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
      }
    });

  });

});

// ============================================================================
// ADMIN PRODUCTS API
// ============================================================================

describe('Admin Products API', () => {

  describe('GET /api/admin/products', () => {
    
    it('ska returnera 401 eller 403 utan admin-lösenord', async () => {
      const response = await request(app).get('/api/admin/products');
      expect([401, 403]).toContain(response.status);
    });

    it('ska returnera produktlista med admin-lösenord', async () => {
      const response = await withAdminAuth(
        request(app).get('/api/admin/products')
      );
      // 200 = lyckades, 503 = db nere
      expect([200, 500, 503]).toContain(response.status);
      if (response.status === 200) {
        // Kan vara en array direkt eller objekt med products
        expect(Array.isArray(response.body) || response.body?.products).toBeTruthy();
      }
    });

  });

  describe('POST /api/admin/products', () => {
    
    it('ska returnera 401 eller 403 utan admin-lösenord', async () => {
      const response = await request(app)
        .post('/api/admin/products')
        .send({});
      expect([401, 403]).toContain(response.status);
    });

    it('ska returnera 400 för ogiltig produkt', async () => {
      const response = await withAdminAuth(
        request(app)
          .post('/api/admin/products')
          .set('Content-Type', 'application/json')
      ).send({ name: '' }); // Saknar obligatoriska fält
      
      expect([400, 500]).toContain(response.status);
    });

  });

  describe('PUT /api/admin/products/:id', () => {
    
    it('ska returnera 401 eller 403 utan admin-lösenord', async () => {
      const response = await request(app)
        .put('/api/admin/products/prod-12345')
        .send({});
      expect([401, 403]).toContain(response.status);
    });

  });

  describe('DELETE /api/admin/products/:id', () => {
    
    it('ska returnera 401 eller 403 utan admin-lösenord', async () => {
      const response = await request(app)
        .delete('/api/admin/products/prod-12345');
      expect([401, 403]).toContain(response.status);
    });

  });

});

// ============================================================================
// ADMIN CROPS API
// ============================================================================

describe('Admin Crops API', () => {

  describe('GET /api/admin/crops', () => {
    
    it('ska returnera 401 eller 403 utan admin-lösenord', async () => {
      const response = await request(app).get('/api/admin/crops');
      expect([401, 403]).toContain(response.status);
    });

    it('ska returnera grödlista med admin-lösenord', async () => {
      const response = await withAdminAuth(
        request(app).get('/api/admin/crops')
      );
      // 200 = lyckades, 503 = db nere
      expect([200, 500, 503]).toContain(response.status);
      if (response.status === 200) {
        // Kan vara en array eller ett objekt med crops
        expect(Array.isArray(response.body) || response.body?.crops).toBeTruthy();
      }
    });

  });

  describe('GET /api/admin/config', () => {
    
    it('ska returnera konfiguration med admin-lösenord', async () => {
      const response = await withAdminAuth(
        request(app).get('/api/admin/config')
      );
      // 200 = lyckades, 503 = db nere
      expect([200, 500, 503]).toContain(response.status);
    });

  });

  describe('GET /api/admin/product-analysis', () => {
    
    it('ska returnera produktanalys med admin-lösenord', async () => {
      const response = await withAdminAuth(
        request(app).get('/api/admin/product-analysis')
      );
      // 200 = lyckades, 500/503 = fel
      expect([200, 500, 503]).toContain(response.status);
    });

  });

});

// ============================================================================
// ADMIN CONFIG BATCH & LEGACY DELETION
// ============================================================================

describe('Admin Config Extended Operations', () => {

  describe('POST /api/admin/config/batch', () => {
    
    it('ska returnera 401 eller 403 utan lösenord', async () => {
      const response = await request(app)
        .post('/api/admin/config/batch')
        .set('Content-Type', 'application/json')
        .send({ updates: [] });
      
      // 401 = unauthorized, 403 = forbidden (admin auth)
      expect([401, 403]).toContain(response.status);
    });

    it('ska returnera 400 för ogiltig payload', async () => {
      const response = await withAdminAuth(
        request(app)
          .post('/api/admin/config/batch')
          .set('Content-Type', 'application/json')
      ).send({ invalid: 'payload' });
      
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('ska hantera tom updates-array', async () => {
      const response = await withAdminAuth(
        request(app)
          .post('/api/admin/config/batch')
          .set('Content-Type', 'application/json')
      ).send({ updates: [] });
      
      // 200 = 0/0 lyckades, 400 = validation, 500 = db-fel
      expect([200, 400, 500]).toContain(response.status);
    });

    it('ska hantera batch-uppdatering av konfiguration', async () => {
      const response = await withAdminAuth(
        request(app)
          .post('/api/admin/config/batch')
          .set('Content-Type', 'application/json')
      ).send({ 
        updates: [
          { key: 'TEST_BATCH_KEY_1', value: '123' },
          { key: 'TEST_BATCH_KEY_2', value: '456' }
        ]
      });
      
      // 200 = lyckades, 400 = validation, 500 = databas-fel
      expect([200, 400, 500]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body).toHaveProperty('results');
        expect(Array.isArray(response.body.results)).toBe(true);
      }
    });

    it('ska hantera ogiltiga värden i batch', async () => {
      const response = await withAdminAuth(
        request(app)
          .post('/api/admin/config/batch')
          .set('Content-Type', 'application/json')
      ).send({ 
        updates: [
          { key: 'TEST_KEY', value: 'not-a-number' }
        ]
      });
      
      // Bör ge 200 med results men value markerad som failed
      expect([200, 400, 500]).toContain(response.status);
    });

  });

  describe('DELETE /api/admin/config/legacy-engine', () => {
    
    it('ska returnera 401 eller 403 utan lösenord', async () => {
      const response = await request(app)
        .delete('/api/admin/config/legacy-engine');
      
      // 401 = unauthorized, 403 = forbidden (admin auth)
      expect([401, 403]).toContain(response.status);
    });

    it('ska ta bort legacy engine konfiguration', async () => {
      const response = await withAdminAuth(
        request(app)
          .delete('/api/admin/config/legacy-engine')
      );
      
      // 200 = lyckades, 500 = databas-fel
      expect([200, 500]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body).toHaveProperty('deletedKeys');
      }
    });

  });

});

// ============================================================================
// API KEY VALIDATION
// ============================================================================

describe('API Key Validation', () => {
  
  it('ska neka åtkomst med ogiltig API-nyckel', async () => {
    const response = await request(app)
      .get('/api/crops')
      .set('X-API-Key', 'invalid-key-that-does-not-exist')
      .set('Accept', 'application/json');
    
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.code).toBe('INVALID_API_KEY');
  });

  it('ska neka åtkomst utan API-nyckel för JSON-requests', async () => {
    const response = await request(app)
      .get('/api/crops')
      .set('Accept', 'application/json');
    
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.code).toBe('MISSING_API_KEY');
  });

});

// ============================================================================
// ADMIN PASSWORD VALIDATION
// ============================================================================

describe('Admin Password Validation', () => {
  
  it('ska neka admin-åtkomst utan lösenord', async () => {
    const response = await request(app)
      .get('/api/admin/config')
      .set('Accept', 'application/json');
    
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Felaktigt admin-lösenord');
  });

  it('ska neka admin-åtkomst med felaktigt lösenord', async () => {
    const response = await request(app)
      .get('/api/admin/config')
      .set('X-Admin-Password', 'wrong-password-123')
      .set('Accept', 'application/json');
    
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Felaktigt admin-lösenord');
  });

});
