import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import * as path from 'path';
import { FeedbackPage } from './pom/FeedbackPage.js';

test.describe('Customer Feedback Form', () => {
  let feedbackPage: FeedbackPage;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const localUrl = `file://${path.resolve(__dirname, 'target-app/feedback.html')}`;

  test.beforeEach(async ({ page }) => {
    feedbackPage = new FeedbackPage(page);
    await feedbackPage.goto(localUrl);
  });

  test('page loads correctly', async ({ page }) => {
    await expect(page).toHaveTitle('Customer Feedback');
    await expect(page.getByRole('heading', { name: 'Share Your Feedback' })).toBeVisible();
  });

  test('form submission shows thank you message', async ({ page }) => {
    await feedbackPage.submitFeedback('7', 'Great service!', false);
    await feedbackPage.expectSuccess();
  });

  test('default radio button is checked', async ({ page }) => {
    await expect(feedbackPage.recommendYes).toBeChecked();
    await expect(feedbackPage.recommendNo).not.toBeChecked();
  });

  test('default range value is 5', async ({ page }) => {
    await expect(feedbackPage.experienceRange).toHaveValue('5');
  });

  test('static text elements are visible', async ({ page }) => {
    await expect(page.getByText("We'd love to hear about your experience with our platform.")).toBeVisible();
    const ratingLabels = page.locator('.rating-labels');
    await expect(ratingLabels).toContainText('Poor');
    await expect(ratingLabels).toContainText('Neutral');
    await expect(ratingLabels).toContainText('Excellent');

    const recommendGroup = page.locator('.form-group', { hasText: 'Would you recommend us?' });
    await expect(recommendGroup).toContainText('Yes');
    await expect(recommendGroup).toContainText('No');
  });
});
