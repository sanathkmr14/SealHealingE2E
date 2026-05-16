import { chromium } from 'playwright';
import * as path from 'path';
import { fileURLToPath } from 'url';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, '../ai-test-suite/index.html')}`;
    
    await page.goto(localUrl);
    
    await page.getByLabel('Full Name').fill('Test User');
    await page.getByLabel('Email Address').fill('test@example.com');
    await page.getByLabel('Message').fill('Testing button state.');

    console.log('Clicking button...');
    await page.getByRole('button', { name: 'Submit Message' }).click();
    
    try {
        console.log('Checking for "Sending..." button...');
        await page.getByRole('button', { name: 'Sending...' }).waitFor({ state: 'attached', timeout: 2000 });
        console.log('Found "Sending..." button!');
        const isDisabled = await page.getByRole('button', { name: 'Sending...' }).isDisabled();
        console.log('Is disabled:', isDisabled);
    } catch (e) {
        console.error('Failed to find "Sending..." button:', (e as Error).message);
        const html = await page.content();
        console.log('Button HTML:', html.match(/<button.*?>.*?<\/button>/s)?.[0]);
    }

    await browser.close();
})();
