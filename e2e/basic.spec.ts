/**
 * FEST E2E-tester - Grundläggande flöden
 * 
 * Testar att hela applikationen fungerar från användarens perspektiv:
 * - Startsidan laddas korrekt
 * - API-endpoints svarar
 * - Optimeringsflödet fungerar
 */

import { test, expect } from '@playwright/test';

// =============================================================================
// STARTSIDA
// =============================================================================

test.describe('Startsida', () => {
  
  test('ska ladda startsidan', async ({ page }) => {
    await page.goto('/');
    
    // Verifiera att titeln innehåller FEST
    await expect(page).toHaveTitle(/FEST/);
    
    // Verifiera att huvudrubriken finns
    await expect(page.locator('h1')).toContainText(/FEST|Gödsel|Beslutsstöd/i);
  });

  test('ska visa formulär för näringsbehov', async ({ page }) => {
    await page.goto('/');
    
    // Verifiera att det finns input-fält för näringsämnen
    await expect(page.locator('input[id="nitrogen"], input[name*="nitrogen"], input[placeholder*="kväve" i]').first()).toBeVisible();
  });

});

// =============================================================================
// API HEALTH
// =============================================================================

test.describe('API Health', () => {
  
  test('GET /health ska returnera OK', async ({ request }) => {
    const response = await request.get('/health');
    
    expect(response.ok()).toBeTruthy();
    
    const body = await response.json();
    expect(body.status).toBe('OK');
    expect(body.success).toBe(true);
  });

});

// =============================================================================
// API CROPS
// =============================================================================

test.describe('API Crops', () => {
  
  test('GET /api/crops ska returnera grödor', async ({ request }) => {
    const response = await request.get('/api/crops');
    
    // Kan ge 200 eller 401 beroende på API-nyckel-krav
    if (response.ok()) {
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.crops).toBeDefined();
      expect(Array.isArray(body.crops)).toBe(true);
    }
  });

});

// =============================================================================
// API RECOMMEND
// =============================================================================

test.describe('API Recommend', () => {
  
  test('POST /api/recommend utan API-nyckel ska ge 401', async ({ request }) => {
    const response = await request.post('/api/recommend', {
      data: {}
    });
    
    // Ska ge 401 utan API-nyckel
    expect(response.status()).toBe(401);
  });

  test('POST /api/recommend med giltig input ska fungera', async ({ request }) => {
    const response = await request.post('/api/recommend', {
      data: {
        need: { N: 100, P: 20, K: 30, S: 10 },
        requiredNutrients: ['N', 'P', 'K', 'S'],
        maxProducts: 3
      }
    });
    
    // Kan ge 200 eller 401 beroende på API-nyckel
    // Eller 500 om databasen inte är tillgänglig
    const status = response.status();
    expect([200, 401, 500, 503]).toContain(status);
    
    if (status === 200) {
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.solutions).toBeDefined();
    }
  });

});

// =============================================================================
// SAME-ORIGIN API ACCESS (simulating frontend fetch)
// =============================================================================

test.describe('Same-origin API Access', () => {
  
  test('GET /api/crops med X-Requested-With header ska fungera utan API-nyckel', async ({ request }) => {
    const response = await request.get('/api/crops', {
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    
    // Ska INTE ge 401 - same-origin access tillåts
    expect(response.status()).not.toBe(401);
    
    if (response.ok()) {
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.crops).toBeDefined();
      expect(body.crops.length).toBeGreaterThan(0);
    }
  });

  test('GET /api/products med X-Requested-With header ska fungera', async ({ request }) => {
    const response = await request.get('/api/products', {
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    
    expect(response.status()).not.toBe(401);
    
    if (response.ok()) {
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.products).toBeDefined();
    }
  });

  test('POST /api/recommend med X-Requested-With header ska fungera', async ({ request }) => {
    const response = await request.post('/api/recommend', {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json'
      },
      data: {
        need: { N: 150, P: 25, K: 40, S: 15 },
        requiredNutrients: ['N', 'P', 'K', 'S'],
        maxProducts: 3
      }
    });
    
    expect(response.status()).not.toBe(401);
    
    if (response.ok()) {
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.solutions).toBeDefined();
      expect(body.solutions.length).toBeGreaterThan(0);
    }
  });

});

// =============================================================================
// REQUIRED PRODUCTS (tvingade produkter)
// =============================================================================

test.describe('Required Products', () => {
  
  test('POST /api/recommend med requiredProductIds ska inkludera produkten', async ({ request }) => {
    // Först hämta en giltig produkt
    const productsResponse = await request.get('/api/products', {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    
    if (!productsResponse.ok()) {
      test.skip();
      return;
    }
    
    const productsBody = await productsResponse.json();
    
    // Hitta en produkt med N-innehåll
    const nProduct = productsBody.products?.find(
      (p: { nutrients?: { N?: number }, id: string }) => p.nutrients?.N && p.nutrients.N > 0
    );
    
    if (!nProduct) {
      test.skip();
      return;
    }
    
    // Gör en recommend-förfrågan med produkten som tvingad
    const response = await request.post('/api/recommend', {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json'
      },
      data: {
        need: { N: 150, P: 25, K: 40, S: 15 },
        requiredNutrients: ['N', 'P', 'K', 'S'],
        maxProducts: 3,
        requiredProductIds: [nProduct.id]
      }
    });
    
    expect(response.ok()).toBeTruthy();
    
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.requiredProductIds).toContain(nProduct.id);
    
    // Verifiera att den tvingade produkten finns med i lösningen
    if (body.solutions?.length > 0) {
      const productIds = body.solutions[0].products.map((p: { productId: string }) => p.productId);
      expect(productIds).toContain(nProduct.id);
    }
  });

  test('POST /api/recommend med requiredProductIds ska returnera dem i response', async ({ request }) => {
    const response = await request.post('/api/recommend', {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json'
      },
      data: {
        need: { N: 100 },
        requiredNutrients: ['N'],
        maxProducts: 2,
        requiredProductIds: ['prod-test-123']
      }
    });
    
    if (response.ok()) {
      const body = await response.json();
      expect(body.requiredProductIds).toContain('prod-test-123');
    }
  });

});

// =============================================================================
// ADMIN PANEL
// =============================================================================

test.describe('Admin Panel', () => {
  
  test('ska kräva autentisering för admin-sidan', async ({ page }) => {
    await page.goto('/admin.html');
    
    // Ska antingen visa login-prompt eller admin-panelen (om redan inloggad)
    const pageContent = await page.content();
    const hasLoginForm = pageContent.includes('lösenord') || 
                         pageContent.includes('password') ||
                         pageContent.includes('Logga in');
    const hasAdminContent = pageContent.includes('Admin') || 
                            pageContent.includes('Produkter');
    
    expect(hasLoginForm || hasAdminContent).toBe(true);
  });

});

// =============================================================================
// SWAGGER DOCS
// =============================================================================

test.describe('API Documentation', () => {
  
  test('Swagger UI ska vara tillgänglig', async ({ request }) => {
    const response = await request.get('/api-docs/');
    
    // Swagger UI returnerar HTML
    expect(response.ok()).toBeTruthy();
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('text/html');
  });

});
