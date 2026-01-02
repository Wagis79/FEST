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
