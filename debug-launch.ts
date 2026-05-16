import { chromium } from '@playwright/test';

(async () => {
  try {
    console.log('Launching browser...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('Browser launched successfully!');
    const page = await browser.newPage();
    await page.goto('https://example.com');
    console.log('Page title:', await page.title());
    await browser.close();
  } catch (error) {
    console.error('Launch failed:', error);
  }
})();
