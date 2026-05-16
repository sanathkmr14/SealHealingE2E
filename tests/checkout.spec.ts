import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import * as path from 'path';

test.describe('Secure Checkout Page', () => {
  
  test('should load with correct title and heading', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/checkout.html')}`;
    await page.goto(localUrl);
    
    await expect(page).toHaveTitle('Secure Checkout');
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  });

  test('should display total amount', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/checkout.html')}`;
    await page.goto(localUrl);
    
    await expect(page.getByText('Total: $99.00')).toBeVisible();
  });

  test('should display Pay button with correct text', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/checkout.html')}`;
    await page.goto(localUrl);
    
    const payButton = page.getByRole('button', { name: 'Pay' });
    await expect(payButton).toBeVisible();
    await expect(payButton).toHaveText('Pay');
  });

  test('Pay button should be enabled by default', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/checkout.html')}`;
    await page.goto(localUrl);
    
    const payButton = page.getByRole('button', { name: 'Pay' });
    await expect(payButton).toBeEnabled();
  });

});
