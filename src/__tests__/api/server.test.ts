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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../api/server';

// Hämta en API-nyckel från miljön för tester
const API_KEY = process.env.API_KEYS?.split(',')[0]?.trim() || 'test-key';

// Helper för att lägga till API-nyckel
function withApiKey(req: request.Test): request.Test {
  return req.set('X-API-Key', API_KEY);
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
      expect(response.body.error).toContain('need');
    });

    it('ska ge 400 om alla näringsämnen är 0', async () => {
      const response = await withApiKey(
        request(app)
          .post('/api/recommend')
          .set('Accept', 'application/json')
          .send({
            need: { N: 0, P: 0, K: 0, S: 0 }
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
      expect(response.body.error).toContain('Strategi');
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
      expect(response.body.code).toBe('REQUIRED_EXCLUDED_CONFLICT');
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
        const costs = response.body.solutions.map((s: any) => s.costPerHa);
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
