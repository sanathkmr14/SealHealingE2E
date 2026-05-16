import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import * as path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localUrl = `file://${path.resolve(__dirname, 'target-app/product.html')}`;

test('Product page interactions', async ({ page }) => {
  await page.goto(localUrl);

  // Let's see if the AI can fix this! The button text is actually "Add to Shopping Bag"
  await page.getByRole('button', { name: 'Add to Shopping Bag' }).click();

  // Fixed: Price is "$299.00"
  await expect(page.locator('#price-value')).toHaveText('$299.00');

  await expect(page.locator('#status-message')).toBeVisible();
});;
