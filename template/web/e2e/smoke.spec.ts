import { test, expect } from '@playwright/test';

// Day-one smoke — login → SSO entry. Uses the testId convention so e2e coverage
// starts non-zero. reference_testid_naming_convention.
test('login page offers SSO and does not loop', async ({ page }) => {
  // Land on /login with an explicit error so the loop-guard dead-ends instead of
  // auto-redirecting to SalesPort (which we don't drive here).
  await page.goto('/login?sso_err=no_role');
  // Heading role, not getByText: the no_role error copy also contains the app
  // name ("You don't have access to __APP_NAME__…"), so a bare text locator is
  // a strict-mode double match (found live on the FinPort mint, 2026-08-22).
  await expect(page.getByRole('heading', { name: '__APP_NAME__' })).toBeVisible();
  await expect(page.getByRole('button', { name: /try again/i })).toBeVisible();
});
