import { expect, test, type Page } from '@playwright/test';
const orgId = '11111111-2222-4333-8444-555555555555';
const projectId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const org = { id: orgId, name: 'Studio Aurora', slug: 'studio-aurora', role: 'OWNER' };
const project = { id: projectId, organizationId: orgId, name: 'Assistenza clienti', slug: 'assistenza-clienti', description: 'Conversazioni con i clienti', status: 'ACTIVE' };
const base = `**/api/organizations/${orgId}/projects`;

async function login(page: Page, deepLink = false, expectWorkspace = true) {
  await page.goto(`/#organization=${orgId}${deepLink ? `&project=${projectId}` : ''}`);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await page.locator('#username').fill(process.env.DIALOGA_TEST_USERNAME || 'dialoga-test');
  await page.locator('#password').fill(process.env.DIALOGA_TEST_PASSWORD || 'dialoga-local-password');
  await page.locator('#kc-login').click();
  if (expectWorkspace) await expect(page.getByRole('heading', { name: 'Studio Aurora', exact: true })).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.route(`**/api/organizations/${orgId}`, route => route.fulfill({ json: org }));
});

test('owner creates once, reads detail, reloads and returns to list', async ({ page }) => {
  let created = false, posts = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(base, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: created ? [project] : [] });
    posts++;
    expect(route.request().postDataJSON()).toEqual({ name: project.name, slug: project.slug, description: project.description });
    await gate; created = true;
    return route.fulfill({ status: 201, json: project });
  });
  let reads = 0;
  await page.route(`${base}/${projectId}`, route => { reads++; return route.fulfill({ json: project }); });
  await login(page);
  await expect(page.getByText('Nessun progetto attivo.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Nuovo progetto' }).click();
  await page.getByLabel('Nome del progetto', { exact: true }).fill(project.name);
  await expect(page.getByLabel('Indirizzo del progetto', { exact: true })).toHaveValue(project.slug);
  await page.getByLabel('Descrizione (facoltativa)').fill(project.description);
  await page.locator('.project-form').evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect.poll(() => posts).toBe(1);
  await expect(page.getByRole('button', { name: 'Creazione progetto in corso…' })).toBeDisabled();
  release();
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
  await expect(page.getByText(project.description, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`&project=${projectId}$`));
  const before = reads;
  await page.reload();
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
  expect(reads).toBeGreaterThan(before);
  await page.getByRole('button', { name: 'Torna ai progetti', exact: false }).click();
  await expect(page.locator('.project-list')).toContainText(project.name);
  expect(posts).toBe(1);
});

test('member sees assigned list and has no create action', async ({ page }) => {
  await page.route(`**/api/organizations/${orgId}`, route => route.fulfill({ json: { ...org, role: 'MEMBER' } }));
  await page.route(base, route => route.fulfill({ json: [project] }));
  await page.route(`${base}/${projectId}`, route => route.fulfill({ json: project }));
  await login(page);
  await expect(page.locator('.project-list')).toContainText(project.name);
  await expect(page.getByRole('button', { name: 'Nuovo progetto' })).toHaveCount(0);
  await page.locator('.project-list button').click();
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
});

test('slug conflict retains form and manual slug; invalid slug is blocked locally', async ({ page }) => {
  let posts = 0;
  await page.route(base, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    posts++; return route.fulfill({ status: 409, json: {} });
  });
  await login(page);
  await page.getByRole('button', { name: 'Nuovo progetto' }).click();
  await page.getByLabel('Nome del progetto', { exact: true }).fill('Caffè clienti');
  await expect(page.getByLabel('Indirizzo del progetto', { exact: true })).toHaveValue('caffe-clienti');
  await page.getByLabel('Indirizzo del progetto', { exact: true }).fill('BAD SLUG');
  await page.getByRole('button', { name: 'Crea progetto', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('lettere minuscole');
  expect(posts).toBe(0);
  await page.getByLabel('Indirizzo del progetto', { exact: true }).fill('manuale');
  await page.getByLabel('Nome del progetto', { exact: true }).fill('Nome cambiato');
  await expect(page.getByLabel('Indirizzo del progetto', { exact: true })).toHaveValue('manuale');
  await page.getByRole('button', { name: 'Crea progetto', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('già usato');
  await expect(page.getByLabel('Nome del progetto', { exact: true })).toHaveValue('Nome cambiato');
  expect(posts).toBe(1);
});

test('list error can be retried without displaying an empty list', async ({ page }) => {
  let fail = true;
  await page.route(base, route => route.fulfill({ status: fail ? 503 : 200, json: fail ? {} : [project] }));
  await login(page);
  await expect(page.getByRole('alert')).toContainText('caricare i progetti');
  await expect(page.getByRole('button', { name: 'Nuovo progetto' })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Ricarica progetti', exact: true }).click();
  await expect(page.locator('.project-list')).toContainText(project.name);
});

test('unavailable project deep link discloses no detail and can return to list', async ({ page }) => {
  await page.route(base, route => route.fulfill({ json: [] }));
  await page.route(`${base}/${projectId}`, route => route.fulfill({ status: 404, json: {} }));
  await login(page, true);
  await expect(page.getByRole('alert')).toContainText('non disponibile o non accessibile');
  await expect(page.locator('.project-detail')).toHaveCount(0);
  await page.getByRole('button', { name: 'Torna ai progetti', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Nuovo progetto' })).toBeVisible();
  await expect(page).not.toHaveURL(/&project=/);
});

test('server permission denial is shown even with a stale owner role', async ({ page }) => {
  await page.route(base, route => route.fulfill(route.request().method() === 'GET' ? { json: [] } : { status: 403, json: {} }));
  await login(page);
  await page.getByRole('button', { name: 'Nuovo progetto' }).click();
  await page.getByLabel('Nome del progetto', { exact: true }).fill('Denied');
  await page.getByRole('button', { name: 'Crea progetto', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Solo il proprietario o un amministratore');
  await expect(page.locator('.project-detail')).toHaveCount(0);
});

test('project API 401 clears private workspace', async ({ page }) => {
  await page.route(base, route => route.fulfill({ status: 401, json: {} }));
  await login(page, false, false);
  await expect(page.getByRole('status')).toContainText('La sessione è scaduta');
  await expect(page.getByRole('button', { name: 'Accedi', exact: true })).toBeVisible();
  await expect(page.locator('.projects-panel')).toHaveCount(0);
});
