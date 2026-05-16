import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import * as path from 'path';

test.describe('Sample App Login Form Tests', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const localUrl = `file://${path.resolve(__dirname, '../separate-folder/sample.html')}`;

  test('should load the page with correct title', async ({ page }) => {
    await page.goto(localUrl);
    await expect(page).toHaveTitle('Sample App');
  });

  test('should display the login heading', async ({ page }) => {
    await page.goto(localUrl);
    await expect(page.getByRole('heading', { name: 'Login to App' })).toBeVisible();
  });

  test('should have username input visible and editable', async ({ page }) => {
    await page.goto(localUrl);
    const usernameInput = page.getByPlaceholder('Enter username');
    await expect(usernameInput).toBeVisible();
    await usernameInput.fill('testuser');
    await expect(usernameInput).toHaveValue('testuser');
  });

  test('should have password input visible and editable', async ({ page }) => {
    await page.goto(localUrl);
    const passwordInput = page.getByLabel('Security Token');
    await expect(passwordInput).toBeVisible();
    await passwordInput.fill('mypassword');
    await expect(passwordInput).toHaveValue('mypassword');
  });

  test('should have Login button visible', async ({ page }) => {
    await page.goto(localUrl);
    const loginButton = page.getByRole('button', { name: 'Login' });
    await expect(loginButton).toBeVisible();
    await expect(loginButton).toHaveText('Login');
  });

  test('should fill form and submit successfully', async ({ page }) => {
    await page.goto(localUrl);
    await page.getByPlaceholder('Enter username').fill('JohnDoe');
    await page.getByLabel('Security Token').fill('secret123');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.locator('#message')).toHaveText('');
    await expect(page.locator('#message')).toHaveCSS('color', 'rgb(0, 128, 0)');
  });

  test('should show error when username is empty', async ({ page }) => {
    await page.goto(localUrl);
    await page.getByPlaceholder('Enter username').fill('');
    await page.locator('#submitBtn').click();
    await expect(page.locator('#message')).toHaveText('');
    await expect(page.locator('#message')).toHaveCSS('color', 'rgb(0, 128, 0)');
  });

  test('should have placeholder text in inputs', async ({ page }) => {
    await page.goto(localUrl);
    const usernameInput = page.getByPlaceholder('Enter username');
    const passwordInput = page.getByLabel('Security Token');
    await expect(usernameInput).toHaveAttribute('placeholder', 'Enter username');
    await expect(passwordInput).toHaveAttribute('placeholder', 'Enter password');
  });

  test('should preserve username after typing', async ({ page }) => {
    await page.goto(localUrl);
    await page.getByPlaceholder('Enter username').fill('Alice');
    await page.getByLabel('Security Token').focus();
    await expect(page.getByPlaceholder('Enter username')).toHaveValue('Alice');
  });
});
