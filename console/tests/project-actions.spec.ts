import { expect, test, type Page } from '@playwright/test';
import type { Project } from '../src/projects';

const orgId = '34567890-1234-4234-8234-123456789abc';
const projectId = '34567890-1234-4234-8234-123456789def';
const org = { id: orgId, name: 'Studio Aurora', slug: 'studio-aurora', role: 'OWNER' };
const project: Project = { id: projectId, organizationId: orgId, name: 'Assistenza clienti', slug: 'assistenza-clienti', description: 'Descrizione iniziale', status: 'ACTIVE' };
const base = `**/api/organizations/${orgId}/projects`;
async function login(page: Page) {
  await page.goto(`/#organization=${orgId}&project=${projectId}`);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await page.locator('#username').fill(process.env.DIALOGA_TEST_USERNAME || 'dialoga-test');
  await page.locator('#password').fill(process.env.DIALOGA_TEST_PASSWORD || 'dialoga-local-password');
  await page.locator('#kc-login').click();
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.route(`**/api/organizations/${orgId}`, route => route.fulfill({ json: org }));
  await page.route(base, route => route.fulfill({ json: [project] }));
  await page.route(`${base}/${projectId}`, route => route.fulfill({ json: project }));
});

test('edit sends one PUT, keeps slug stable and updates detail, list and reload', async ({ page }) => {
  let saved = project, writes = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(base, route => route.fulfill({ json: [saved] }));
  await page.route(`${base}/${projectId}`, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: saved });
    writes++;
    expect(route.request().postDataJSON()).toEqual({ name: 'Nuovo nome', description: null });
    await gate; saved = { ...project, name: 'Nuovo nome', description: null };
    return route.fulfill({ json: saved });
  });
  await login(page);
  await page.getByRole('button', { name: 'Modifica progetto', exact: true }).click();
  await expect(page.getByLabel('Nome del progetto', { exact: true })).toHaveValue(project.name);
  await expect(page.getByLabel('Descrizione (facoltativa)')).toHaveValue(project.description || '');
  await page.getByLabel('Nome del progetto', { exact: true }).fill('  Nuovo nome  ');
  await page.getByLabel('Descrizione (facoltativa)').fill('  ');
  await page.locator('.project-actions form').evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect.poll(() => writes).toBe(1);
  await expect(page.getByRole('button', { name: 'Salvataggio in corso…' })).toBeDisabled(); release();
  await expect(page.getByRole('heading', { name: 'Nuovo nome', exact: true })).toBeVisible();
  await expect(page.locator('.project-detail')).toContainText(project.slug);
  await expect(page.locator('.project-detail')).toContainText('Nessuna descrizione.');
  await page.getByRole('button', { name: 'Torna ai progetti', exact: false }).click();
  await expect(page.locator('.project-list')).toContainText('Nuovo nome');
  await page.locator('.project-list button').click(); await page.reload();
  await expect(page.getByRole('heading', { name: 'Nuovo nome', exact: true })).toBeVisible();
  expect(writes).toBe(1);
});

test('archive requires confirmation, can be cancelled and removes project after success', async ({ page }) => {
  let archived = false, writes = 0;
  await page.route(base, route => route.fulfill({ json: archived ? [] : [project] }));
  await page.route(`${base}/${projectId}/archive`, route => { writes++; archived = true; return route.fulfill({ status: 204 }); });
  await login(page);
  await page.getByRole('button', { name: 'Archivia progetto', exact: true }).click();
  await expect(page.getByText('Potrai ripristinarlo dalla sezione Progetti archiviati.', { exact: false })).toBeVisible();
  expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Annulla archiviazione' }).click(); expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Archivia progetto', exact: true }).click();
  await page.getByRole('button', { name: 'Conferma archiviazione', exact: true }).click();
  await expect(page.getByText('Progetto archiviato. I dati sono stati conservati.', { exact: true })).toBeVisible();
  await expect(page.locator('.project-detail')).toHaveCount(0);
  await expect(page.locator('.project-list')).toHaveCount(0);
  await expect(page).not.toHaveURL(/&project=/); expect(writes).toBe(1);
});

test('member cannot see edit or archive actions', async ({ page }) => {
  await page.route(`**/api/organizations/${orgId}`, route => route.fulfill({ json: { ...org, role: 'MEMBER' } }));
  await login(page);
  await expect(page.getByRole('button', { name: 'Modifica progetto', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archivia progetto', exact: true })).toHaveCount(0);
});

test('server 403 removes stale privileged detail and allows safe reload', async ({ page }) => {
  await page.route(`${base}/${projectId}`, route => route.fulfill(route.request().method() === 'GET' ? { json: project } : { status: 403, json: {} }));
  await login(page); await page.getByRole('button', { name: 'Modifica progetto', exact: true }).click();
  await page.getByRole('button', { name: 'Salva modifiche' }).click();
  await expect(page.getByRole('alert')).toContainText('Solo il proprietario');
  await expect(page.locator('.project-detail')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Gestisci accessi' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ricarica progetto' })).toBeVisible();
});

test('archive 404 clears detail without claiming success', async ({ page }) => {
  await page.route(`${base}/${projectId}/archive`, route => route.fulfill({ status: 404, json: {} }));
  await login(page); await page.getByRole('button', { name: 'Archivia progetto', exact: true }).click();
  await page.getByRole('button', { name: 'Conferma archiviazione' }).click();
  await expect(page.getByRole('alert')).toContainText('archiviato o non accessibile');
  await expect(page.locator('.project-detail')).toHaveCount(0);
  await expect(page.getByText('Progetto archiviato. I dati sono stati conservati.')).toHaveCount(0);
});

test('failed save retains input and successful retry updates only after response', async ({ page }) => {
  let fail = true;
  await page.route(`${base}/${projectId}`, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: project });
    return route.fulfill(fail ? { status: 503, json: {} } : { json: { ...project, name: 'Riprova' } });
  });
  await login(page); await page.getByRole('button', { name: 'Modifica progetto', exact: true }).click();
  await page.getByLabel('Nome del progetto', { exact: true }).fill('Riprova');
  await page.getByRole('button', { name: 'Salva modifiche' }).click();
  await expect(page.getByRole('alert')).toContainText('Operazione non confermata');
  await expect(page.getByLabel('Nome del progetto', { exact: true })).toHaveValue('Riprova');
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
  fail = false; await page.getByRole('button', { name: 'Salva modifiche' }).click();
  await expect(page.getByRole('heading', { name: 'Riprova', exact: true })).toBeVisible();
});

test('whitespace-only name is rejected locally and cancelling discards edits', async ({ page }) => {
  let writes = 0;
  await page.route(`${base}/${projectId}`, route => {
    if (route.request().method() !== 'GET') writes++;
    return route.fulfill({ json: project });
  });
  await login(page); await page.getByRole('button', { name: 'Modifica progetto', exact: true }).click();
  await page.getByLabel('Nome del progetto', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Salva modifiche' }).click();
  await expect(page.getByRole('alert')).toContainText('Inserisci un nome'); expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Annulla modifica' }).click();
  await page.getByRole('button', { name: 'Modifica progetto', exact: true }).click();
  await expect(page.getByLabel('Nome del progetto', { exact: true })).toHaveValue(project.name);
});

test('archive 401 clears private workspace', async ({ page }) => {
  await page.route(`${base}/${projectId}/archive`, route => route.fulfill({ status: 401, json: {} }));
  await login(page); await page.getByRole('button', { name: 'Archivia progetto', exact: true }).click();
  await page.getByRole('button', { name: 'Conferma archiviazione' }).click();
  await expect(page.getByRole('status')).toContainText('La sessione è scaduta');
  await expect(page.getByRole('button', { name: 'Accedi', exact: true })).toBeVisible();
  await expect(page.locator('.projects-panel')).toHaveCount(0);
});
