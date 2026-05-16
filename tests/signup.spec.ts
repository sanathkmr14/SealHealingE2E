import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import * as path from 'path';

test.describe('Signup Form Tests', () => {
  test('page loads with correct title and heading', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/signup.html')}`;
    await page.goto(localUrl);
    
    await expect(page).toHaveTitle('Create Your Account');
    await expect(page.getByRole('heading', { name: 'Join Our Community' })).toBeVisible();
  });

  test('form elements are visible', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/signup.html')}`;
    await page.goto(localUrl);
    
    await expect(page.getByPlaceholder('John Doe')).toBeVisible();
    await expect(page.getByLabel('Your Email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
  });

  test('visible text is displayed on page', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/signup.html')}`;
    await page.goto(localUrl);
    
    await expect(page.getByText('Fill out the form below to register.')).toBeVisible();
    await expect(page.getByText('First Name')).toBeVisible();
    await expect(page.getByText('Your Email')).toBeVisible();
  });

  test('form can be filled with user data', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/signup.html')}`;
    await page.goto(localUrl);
    
    await page.getByPlaceholder('John Doe').fill('Jane Smith');
    await page.getByLabel('Your Email').fill('jane@example.com');
    
    await expect(page.getByPlaceholder('John Doe')).toHaveValue('Jane Smith');
    await expect(page.getByLabel('Your Email')).toHaveValue('jane@example.com');
  });

  test('create account button is enabled', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, 'target-app/signup.html')}`;
    await page.goto(localUrl);
    
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeEnabled();
  });
});
