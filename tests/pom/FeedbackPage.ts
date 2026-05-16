import { expect, type Page, type Locator } from '@playwright/test';

export class FeedbackPage {
  readonly page: Page;
  readonly experienceRange: Locator;
  readonly commentsTextArea: Locator;
  readonly recommendYes: Locator;
  readonly recommendNo: Locator;
  readonly submitButton: Locator;
  readonly thankYouMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.experienceRange = page.getByTestId('range-experience');
    this.commentsTextArea = page.getByTestId('textarea-comments');
    this.recommendYes = page.getByTestId('radio-recommend-yes');
    this.recommendNo = page.getByTestId('radio-recommend-no');
    this.submitButton = page.getByTestId('button-submit-feedback');
    this.thankYouMessage = page.getByRole('heading', { name: '🎉 Thank you for your feedback!' });
  }

  async goto(url: string) {
    await this.page.goto(url);
  }

  async submitFeedback(rating: string, comments: string, recommend: boolean) {
    await this.experienceRange.fill(rating);
    await this.commentsTextArea.fill(comments);
    if (recommend) {
      await this.recommendYes.click();
    } else {
      await this.recommendNo.click();
    }
    await this.submitButton.click();
  }

  async expectSuccess() {
    await expect(this.thankYouMessage).toBeVisible();
  }
}
