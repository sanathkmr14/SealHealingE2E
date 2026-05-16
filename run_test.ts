import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${path.resolve(__dirname, '../ai-test-suite/index.html')}`);
  
  let start = Date.now();
  await page.getByLabel('Full Name').fill('Test User');
  console.log('Fill 1 took:', Date.now() - start, 'ms');
  
  start = Date.now();
  await page.getByLabel('Email Address').fill('test@example.com');
  console.log('Fill 2 took:', Date.now() - start, 'ms');
  
  start = Date.now();
  await page.getByLabel('Message').fill('Testing button state.');
  console.log('Fill 3 took:', Date.now() - start, 'ms');
  
  start = Date.now();
  await page.getByRole('button', { name: 'Submit Message' }).click({ force: true });
  console.log('Click took:', Date.now() - start, 'ms');
  
  await browser.close();
})();
