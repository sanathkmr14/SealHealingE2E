import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import * as path from 'path';

test.describe('User Settings Page', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const localUrl = `file://${path.resolve(__dirname, 'target-app/settings.html')}`;

  test.beforeEach(async ({ page }) => {
    await page.goto(localUrl);
  });

  test('should load page with correct title and headings', async ({ page }) => {
    await expect(page).toHaveTitle('User Settings');
    await expect(page.getByRole('heading', { name: 'Dashboard Settings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'General Preferences' })).toBeVisible();
  });

  test('should display email notifications checkbox and theme selector', async ({ page }) => {
    const emailCheckbox = page.getByRole('checkbox', { name: 'Send me Emails' });
    await expect(emailCheckbox).toBeVisible();
    await expect(emailCheckbox).toBeChecked();

    const themeSelect = page.locator('#appearance-theme');
    await expect(themeSelect).toBeVisible();
    await expect(themeSelect).toHaveValue('light');
  });

  test('should allow changing theme selection', async ({ page }) => {
    const themeSelect = page.locator('#appearance-theme');
    await themeSelect.selectOption('dark');
    await expect(themeSelect).toHaveValue('dark');
  });

  test('should allow toggling email notifications', async ({ page }) => {
    const emailCheckbox = page.getByRole('checkbox', { name: 'Send me Emails' }); // Intentional error for AutoHeal testing
    await emailCheckbox.uncheck();
    await expect(emailCheckbox).not.toBeChecked();
  });

  test('should have apply settings button', async ({ page }) => {
    const applyButton = page.getByRole('button', { name: 'Update' });
    await expect(applyButton).toBeVisible();
    await expect(applyButton).toBeEnabled();
  });

  test('should navigate to page successfully', async ({ page }) => {
    await expect(page).toHaveURL(/\/settings\.html$/);
  });
});
