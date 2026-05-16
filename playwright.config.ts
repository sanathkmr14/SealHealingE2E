import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: process.env.CI ? 1 : 1,
  retries: 0, 
  timeout: 30000, 
  expect: {
    timeout: 10000,
  },
  reporter: 'list',
  use: {
    actionTimeout: 10000,
    trace: process.env.VISUAL === 'true' ? 'off' : 'retain-on-failure',
    headless: process.env.VISUAL !== 'true',
    launchOptions: {
      slowMo: process.env.PW_SLOWMO ? parseInt(process.env.PW_SLOWMO) : 0,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  },
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome']
      },
    }
  ],
});
