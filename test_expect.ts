import { chromium, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${path.resolve(__dirname, '../ai-test-suite/index.html')}`);
  await page.getByLabel('Full Name').fill('Test User');
  await page.getByLabel('Email Address').fill('test@example.com');
  await page.getByLabel('Message').fill('Testing button state.');
  
  await page.getByRole('button', { name: 'Submit Message' }).click();
  try {
    await expect(page.getByRole('button', { name: 'Sending...' })).toBeDisabled({ timeout: 5000 });
    console.log('Expect succeeded!');
  } catch (e) {
    console.log('Expect failed:', (e as Error).message);
  }
  
  await browser.close();
})();
