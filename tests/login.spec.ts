import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import * as path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localUrl = `file://${path.resolve(__dirname, 'target-app/login.html')}`;

test.describe('Login Page', () => {
  test('should load the page with correct title and heading', async ({ page }) => {
    await page.goto(localUrl);

    await expect(page).toHaveTitle('Login Example');
    await expect(page.locator('h1')).toHaveText('Welcome Back');
  });

  test('should have email and password fields with correct labels', async ({ page }) => {
    await page.goto(localUrl);

    await expect(page.locator('#username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('should have login button that is visible', async ({ page }) => {
    await page.goto(localUrl);

    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('should show error message when clicking login with empty fields', async ({ page }) => {
    await page.goto(localUrl);

    await page.locator('#username').fill('user@example.com');
    await page.getByLabel('Password').fill('password123');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page.locator('#error-message')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#error-message')).toHaveText('Invalid credentials');
  });
});
