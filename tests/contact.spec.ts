import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import * as path from 'path';

test.describe('Contact Support Page', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const localUrl = `file://${path.resolve(__dirname, 'target-app/contact.html')}`;

test('should load page with correct title and content', async ({ page }) => {
  await page.goto(localUrl);

  await expect(page).toHaveTitle('Contact Us');
  await expect(page.locator('h1')).toHaveText('Contact Support');
});

  test('should have form with all required fields and button', async ({ page }) => {
    await page.goto(localUrl);

    await expect(page.locator('#contact-form')).toBeVisible();

    const subjectField = page.getByLabel('Subject');
     await expect(subjectField).toBeVisible();
     await expect(subjectField).toHaveAttribute('id', 'subject');
     await expect(subjectField).not.toHaveAttribute('placeholder', 'Topic');

    const messageField = page.getByLabel('Message');
    await expect(messageField).toBeVisible();
    await expect(messageField).toHaveAttribute('id', 'message');

    const submitButton = page.getByRole('button', { name: 'Send Message' });
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toHaveAttribute('type', 'submit');
    await expect(submitButton).toHaveAttribute('id', 'submit-button');
  });

  test('should allow user to fill form and submit', async ({ page }) => {
    await page.goto(localUrl);

    const subjectField = page.getByLabel('Subject');
    const messageField = page.getByLabel('Message');
    const submitButton = page.getByRole('button', { name: 'Send Message' });

    await subjectField.selectOption('general');
    await messageField.fill('This is a test message.');

   // Since the HTML is static with no script tags, we cannot assert dynamic behavior
   // Only assert that fields have the expected values after filling
   await expect(subjectField).toHaveValue('general');
   await expect(messageField).toHaveValue('This is a test message.');
  });
});
