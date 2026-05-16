import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import * as path from 'path';

test.describe('Search Catalog Page', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const localUrl = `file://${path.resolve(__dirname, 'target-app/search.html')}`;

  test.beforeEach(async ({ page }) => {
    await page.goto(localUrl);
  });

  test('should load page with correct title and heading', async ({ page }) => {
    await expect(page).toHaveTitle('Search Catalog');
    await expect(page.locator('h1')).toHaveText('Product Search');
  });

  test('should display search input and button correctly', async ({ page }) => {
    const searchInput = page.getByTestId('input-search');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveAttribute('placeholder', 'Type here...');

    const searchButton = page.getByTestId('button-find');
    await expect(searchButton).toBeVisible();
  });

  test('should show initial results count', async ({ page }) => {
    await expect(page.getByTestId('results-count')).toBeVisible();
    await expect(page.getByTestId('results-count')).toHaveText('Total items found: 0');
  });

  test('should fill in search query', async ({ page }) => {
    const searchInput = page.getByTestId('input-search');
    await searchInput.fill('laptop');
    await expect(searchInput).toHaveValue('laptop');
  });

  test('should click search button', async ({ page }) => {
    const searchButton = page.getByTestId('button-find');
    await searchButton.click();
  });
});
