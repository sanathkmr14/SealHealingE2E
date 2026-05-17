import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import * as path from 'path';

test.describe('Secure Checkout Page', () => {
  test('should load the checkout page with correct title', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/checkout.html')}`;
    await page.goto(localUrl);
    
    await expect(page).toHaveTitle('Secure Checkout');
  });

  test('should display the checkout heading', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/checkout.html')}`;
    await page.goto(localUrl);
    
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  });

  test('should display the total amount', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/checkout.html')}`;
    await page.goto(localUrl);
    
    await expect(page.getByText('Total: $99.00')).toBeVisible();
  });

  test('should display the pay button', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/checkout.html')}`;
    await page.goto(localUrl);
    
    await expect(page.getByRole('button', { name: 'Pay' })).toBeVisible();
  });

  test('should have pay button with correct id', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/checkout.html')}`;
    await page.goto(localUrl);
    
    const payButton = page.getByRole('button', { name: 'Pay' });
    await expect(payButton).toHaveId('pay-button');
  });

  test('should have pay button with submit type', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/checkout.html')}`;
    await page.goto(localUrl);
    
    const payButton = page.getByRole('button', { name: 'Pay' });
    await expect(payButton).toHaveAttribute('type', 'submit');
  });
});
