import { test, expect } from '@playwright/test';

test.describe('Treasury payment workflow', () => {
  test.fixme(true, 'Frontend integration is not implemented yet; activate this suite when E2E_BASE_URL points to the UI.');

  test('logs in, creates a payment, approves it, and executes it', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/login/);
  });
});
