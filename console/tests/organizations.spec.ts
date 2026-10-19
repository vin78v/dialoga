import { expect, test, type Page } from '@playwright/test';
const id = '11111111-2222-4333-8444-555555555555';
const organization = { id, name: 'Studio Aurora', slug: 'studio-aurora', role: 'OWNER' };
test.beforeEach(async ({ page }) => {
  await page.route('**/api/organizations/*/projects', route => route.fulfill({ json: [] }));
});
async function login(page: Page, path = '/') {
  await page.goto(path);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await page.locator('#username').fill(process.env.DIALOGA_TEST_USERNAME || 'dialoga-test');
  await page.locator('#password').fill(process.env.DIALOGA_TEST_PASSWORD || 'dialoga-local-password');
  await page.locator('#kc-login').click();
  await expect(page.getByText('Sessione attiva', { exact: true })).toBeVisible();
}

test('create once, remember organization and reload it through the API', async ({ page }) => {
  let posts = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/organizations', async route => {
    posts++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ name: 'Studio Aurora', slug: 'studio-aurora' });
    await gate;
    await route.fulfill({ status: 201, json: organization });
  });
  let reads = 0;
  await page.route(`**/api/organizations/${id}`, route => { reads++; return route.fulfill({ json: organization }); });
  await login(page);
  await page.getByLabel('Nome dell’organizzazione').fill('Studio Aurora');
  await expect(page.getByLabel('Indirizzo dell’organizzazione')).toHaveValue('studio-aurora');
  await page.locator('form').evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect.poll(() => posts).toBe(1);
  await expect(page.getByRole('button', { name: 'Creazione in corso…' })).toBeDisabled();
  release();
  await expect(page.getByRole('heading', { name: 'Studio Aurora', exact: true })).toBeVisible();
  await expect(page.getByText('OWNER', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#organization=${id}$`));
  const before = reads;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Studio Aurora', exact: true })).toBeVisible();
  expect(reads).toBeGreaterThan(before);
  expect(posts).toBe(1);
});

test('slug conflict preserves the form and a manually edited slug', async ({ page }) => {
  await page.route('**/api/organizations', route => route.fulfill({ status: 409, json: {} }));
  await login(page);
  await page.getByLabel('Nome dell’organizzazione').fill('Caffè Aurora');
  await expect(page.getByLabel('Indirizzo dell’organizzazione')).toHaveValue('caffe-aurora');
  await page.getByLabel('Indirizzo dell’organizzazione').fill('indirizzo-scelto');
  await page.getByLabel('Nome dell’organizzazione').fill('Un altro nome');
  await expect(page.getByLabel('Indirizzo dell’organizzazione')).toHaveValue('indirizzo-scelto');
  await page.getByRole('button', { name: 'Crea organizzazione', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('già occupato');
  await expect(page.getByLabel('Nome dell’organizzazione')).toHaveValue('Un altro nome');
  await expect(page.getByLabel('Indirizzo dell’organizzazione')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Crea organizzazione', exact: true })).toBeEnabled();
});

test('invalid slug never reaches the API', async ({ page }) => {
  let posts = 0;
  await page.route('**/api/organizations', route => { posts++; return route.fulfill({ status: 400 }); });
  await login(page);
  await page.getByLabel('Nome dell’organizzazione').fill('Valid name');
  await page.getByLabel('Indirizzo dell’organizzazione').fill('BAD SLUG');
  await page.getByRole('button', { name: 'Crea organizzazione', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('lettere minuscole');
  expect(posts).toBe(0);
});

test('unavailable deep link reveals no organization and offers onboarding', async ({ page }) => {
  await page.route(`**/api/organizations/${id}`, route => route.fulfill({ status: 404, json: {} }));
  await login(page, `/#organization=${id}`);
  await expect(page.getByRole('status')).toContainText('non hai più accesso');
  await expect(page.getByRole('heading', { name: 'Crea la tua organizzazione' })).toBeVisible();
  await expect(page).not.toHaveURL(/#organization=/);
  await expect(page.getByText('OWNER', { exact: true })).toHaveCount(0);
});

test('loading failure offers a safe retry instead of creating a duplicate', async ({ page }) => {
  let fail = true;
  await page.route(`**/api/organizations/${id}`, route => route.fulfill({ status: fail ? 503 : 200, json: fail ? {} : organization }));
  await login(page, `/#organization=${id}`);
  await expect(page.getByRole('alert')).toContainText('caricare l’organizzazione');
  await expect(page.getByRole('button', { name: 'Crea organizzazione', exact: true })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Ricarica organizzazione' }).click();
  await expect(page.getByRole('heading', { name: 'Studio Aurora', exact: true })).toBeVisible();
});

test('expired session while creating removes the private screen', async ({ page }) => {
  await page.route('**/api/organizations', route => route.fulfill({ status: 401, json: {} }));
  await login(page);
  await page.getByLabel('Nome dell’organizzazione').fill('Studio Aurora');
  await page.getByRole('button', { name: 'Crea organizzazione', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('La sessione è scaduta');
  await expect(page.getByRole('button', { name: 'Accedi', exact: true })).toBeVisible();
  await expect(page.getByLabel('Nome dell’organizzazione')).toHaveCount(0);
});
