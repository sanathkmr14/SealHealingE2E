import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import * as path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localUrl = `file://${path.resolve(__dirname, 'tests/target-app/signup.html')}`;

test.describe('Account Creation Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(localUrl);
  });

  test('should display form labels and placeholders correctly', async ({ page }) => {
    await expect(page.getByPlaceholder('John Doe')).toBeVisible();
    await expect(page.getByLabel('Your Email')).toBeVisible();
    await expect(page.getByPlaceholder('John Doe')).toHaveAttribute('placeholder', 'John Doe');
    await expect(page.getByLabel('Your Email')).toHaveAttribute('placeholder', 'john@example.com');
  });
});
