import { expect, test, type Page } from '@playwright/test';
const username = process.env.DIALOGA_TEST_USERNAME || 'dialoga-test';
const password = process.env.DIALOGA_TEST_PASSWORD || 'dialoga-local-password';
async function login(page: Page) {
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page.locator('#username')).toBeVisible();
  const url = new URL(page.url());
  expect(url.searchParams.get('response_type')).toBe('code');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('code_challenge')).toBeTruthy();
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
}
test('real Keycloak login, API profile, SSO and provider logout', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Il prossimo passo inizia da qui.' })).toBeVisible();
  await login(page);
  await expect(page.getByText('Sessione attiva', { exact: true })).toBeVisible();
  await expect(page.locator('.profile dd')).not.toBeEmpty();
  expect(new URL(page.url()).searchParams.has('code')).toBe(false);
  expect(await page.evaluate(() => Object.keys(localStorage).some(k => /token/i.test(k)))).toBe(false);
  await page.reload();
  await expect(page.getByText('Sessione attiva', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Esci', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accedi', exact: true })).toBeVisible();
  await expect(page.locator('.profile')).toHaveCount(0);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page.locator('#username')).toBeVisible();
});
test('invalid credentials do not authenticate the console', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await page.locator('#username').fill(username);
  await page.locator('#password').fill('invalid-local-test-password');
  await page.locator('#kc-login').click();
  await expect(page.locator('#username')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Invalid username or password.', { exact: true })).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
});
test('API failure offers a retry without losing authentication', async ({ page }) => {
  await page.route('**/api/me', route => route.fulfill({ status: 503, body: '{}' }));
  await page.goto('/');
  await login(page);
  await expect(page.getByRole('alert')).toContainText('Non è stato possibile caricare il profilo');
  await page.unroute('**/api/me');
  await page.getByRole('button', { name: 'Riprova', exact: true }).click();
  await expect(page.getByText('Sessione attiva', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Esci', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accedi', exact: true })).toBeVisible();
});
test('API 401 clears the local session', async ({ page }) => {
  await page.route('**/api/me', route => route.fulfill({ status: 401, body: '{}' }));
  await page.goto('/');
  await login(page);
  await expect(page.getByRole('status')).toContainText('La sessione è scaduta');
  await expect(page.getByRole('button', { name: 'Accedi', exact: true })).toBeVisible();
  await expect(page.locator('.profile')).toHaveCount(0);
});
