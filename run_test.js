const { chromium } = require('@playwright/test');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${path.resolve(__dirname, '../ai-test-suite/index.html')}`);
  await page.getByLabel('Full Name').fill('Test User');
  await page.getByLabel('Email Address').fill('test@example.com');
  await page.getByLabel('Message').fill('Testing button state.');
  
  const start = Date.now();
  await page.getByRole('button', { name: 'Submit Message' }).click();
  console.log('Click took:', Date.now() - start, 'ms');
  
  await browser.close();
})();
