import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import * as path from 'path';

test.describe('Profile Page Tests', () => {
  test('should load the profile page with correct title and heading', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/profile.html')}`;
    await page.goto(localUrl);
    
    await expect(page).toHaveTitle('Edit Profile');
    await expect(page.getByRole('heading', { name: 'User Profile Settings' })).toBeVisible();
  });

  test('should display the bio textarea with correct label', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/profile.html')}`;
    await page.goto(localUrl);
    
    const bioTextarea = page.getByLabel('About Me');
    await expect(bioTextarea).toBeVisible();
  });

  test('should display the location input with correct label and default value', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/profile.html')}`;
    await page.goto(localUrl);
    
    const locationInput = page.getByLabel('Current City');
    await expect(locationInput).toBeVisible();
    await expect(locationInput).toHaveValue('New York, USA');
  });

  test('should display the Save Changes button', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/profile.html')}`;
    await page.goto(localUrl);
    
    const saveButton = page.locator('form').getByRole('button', { name: 'Save Changes' });
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toHaveAttribute('type', 'submit');
  });

  test('should allow filling the bio textarea', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/profile.html')}`;
    await page.goto(localUrl);
    
    await page.getByLabel('About Me').fill('This is my biography.');
    await expect(page.getByLabel('About Me')).toHaveValue('This is my biography.');
  });

  test('should allow changing the location input', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/profile.html')}`;
    await page.goto(localUrl);
    
    await page.getByLabel('Current City').fill('Los Angeles, USA');
    await expect(page.getByLabel('Current City')).toHaveValue('Los Angeles, USA');
  });
});
