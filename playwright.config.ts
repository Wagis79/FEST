import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E-testkonfiguration för FEST
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  
  // Timeout för varje test
  timeout: 30 * 1000,
  
  // Expect-timeout
  expect: {
    timeout: 5000
  },
  
  // Reporter
  reporter: [
    ['list'],
    ['html', { open: 'never' }]
  ],
  
  // Parallellkörning
  fullyParallel: true,
  
  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,
  
  // Retries
  retries: process.env.CI ? 2 : 0,
  
  // Workers
  workers: process.env.CI ? 1 : undefined,
  
  // Webserver - startar automatiskt servern innan testerna körs
  webServer: {
    command: 'npm run server',
    url: 'http://localhost:3000/health',
    reuseExistingServer: true, // Återanvänd alltid om server körs
    timeout: 30 * 1000,
  },
  
  use: {
    // Base URL för alla tester
    baseURL: 'http://localhost:3000',
    
    // Spara trace vid misslyckade tester
    trace: 'on-first-retry',
    
    // Screenshots vid misslyckade tester
    screenshot: 'only-on-failure',
  },
  
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
