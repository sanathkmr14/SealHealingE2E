import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import * as path from 'path';

test.describe('Contact Form Page Tests', () => {
  test('page loads with correct title and heading', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, '../../ai-test-suite/index.html')}`;
    await page.goto(localUrl);

    await expect(page).toHaveTitle('AI Test Bench | Premium Contact Experience');
    await expect(page.getByRole('heading', { name: 'Get in touch' })).toBeVisible();
    await expect(page.getByText("We'll get back to you within 24 hours.")).toBeVisible();
  });

  test('form inputs are present and accessible', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, '../../ai-test-suite/index.html')}`;
    await page.goto(localUrl);

    await expect(page.getByLabel('Full Name')).toBeVisible();
    await expect(page.getByLabel('Email Address')).toBeVisible();
    await expect(page.getByLabel('Message')).toBeVisible();
    await expect(page.getByLabel('Full Name')).toHaveAttribute('placeholder', 'John Doe');
    await expect(page.getByLabel('Email Address')).toHaveAttribute('placeholder', 'john@example.com');
    await expect(page.getByLabel('Message')).toHaveAttribute('placeholder', 'How can we help?');
  });

  test('submit button is visible and has correct text', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, '../../ai-test-suite/index.html')}`;
    await page.goto(localUrl);

    await expect(page.getByRole('button', { name: 'Submit Message' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit Message' })).toBeEnabled();
  });

  test('form can be filled with valid data', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, '../../ai-test-suite/index.html')}`;
    await page.goto(localUrl);

    await page.getByLabel('Full Name').fill('John Doe');
    await page.getByLabel('Email Address').fill('john@example.com');
    await page.getByLabel('Message').fill('This is a test message.');

    await expect(page.getByLabel('Full Name')).toHaveValue('John Doe');
    await expect(page.getByLabel('Email Address')).toHaveValue('john@example.com');
    await expect(page.getByLabel('Message')).toHaveValue('This is a test message.');
  });

  test('form submission shows success message', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, '../../ai-test-suite/index.html')}`;
    await page.goto(localUrl);

    await page.getByLabel('Full Name').fill('Jane Smith');
    await page.getByLabel('Email Address').fill('jane@example.com');
    await page.getByLabel('Message').fill('Hello, this is a test.');

    await page.getByRole('button', { name: 'Submit Message' }).click();

    await expect(page.getByText('Thank you, Jane Smith! Your message has been sent.')).toBeVisible();
  });

  test('form submission with error name shows error message', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, '../../ai-test-suite/index.html')}`;
    await page.goto(localUrl);

    await page.getByLabel('Full Name').fill('error');
    await page.getByLabel('Email Address').fill('error@example.com');
    await page.getByLabel('Message').fill('This should trigger error.');

    await page.getByRole('button', { name: 'Submit Message' }).click();

    await expect(page.getByText('Something went wrong. Please try again.')).toBeVisible();
  });

  test('form can be reset after successful submission', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, '../../ai-test-suite/index.html')}`;
    await page.goto(localUrl);

    await page.getByLabel('Full Name').fill('Reset Test');
    await page.getByLabel('Email Address').fill('reset@example.com');
    await page.getByLabel('Message').fill('Testing reset functionality.');

    await page.getByRole('button', { name: 'Submit Message' }).click();
    await expect(page.getByText('Thank you, Reset Test! Your message has been sent.')).toBeVisible();

    await expect(page.getByLabel('Full Name')).toHaveValue('');
    await expect(page.getByLabel('Email Address')).toHaveValue('');
    await expect(page.getByLabel('Message')).toHaveValue('');
  });

  test('submit button is disabled during submission', async ({ page }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const localUrl = `file://${path.resolve(__dirname, '../../ai-test-suite/index.html')}`;
    await page.goto(localUrl);

    await page.getByLabel('Full Name').fill('Test User');
    await page.getByLabel('Email Address').fill('test@example.com');
    await page.getByLabel('Message').fill('Testing button state.');

    const submitBtn = page.getByTestId('button-submit');
    const clickPromise = submitBtn.click();
    await expect(submitBtn).toBeDisabled();
    await expect(submitBtn).toHaveText('Sending...');
    await clickPromise;
  });
});
