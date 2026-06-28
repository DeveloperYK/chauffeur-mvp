import { expect, test } from '@playwright/test';

test.describe('smoke', () => {
  test('healthcheck endpoint responds', async ({ request }) => {
    const res = await request.get('/api/healthz');
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test('login page renders for unauthenticated user', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByText('JJ Chauffeuring').first()).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /^sign in/i })).toBeVisible();
  });

  test('dashboard redirects to login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/login');
    expect(page.url()).toContain('/login');
  });

  test('invalid driver link shows safe error', async ({ page }) => {
    await page.goto('/j/garbage-token-value-not-a-real-jwt');
    await expect(page.getByRole('heading', { name: /link unavailable/i })).toBeVisible();
  });
});
