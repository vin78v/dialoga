import { expect, test, type Page } from '@playwright/test';
import type { ArchivedProject, Project } from '../src/projects';

const orgId = '56789012-1234-4234-8234-123456789abc';
const projectId = '56789012-1234-4234-8234-123456789def';
const org = { id: orgId, name: 'Studio Aurora', slug: 'studio-aurora', role: 'OWNER' };
const archived: ArchivedProject = {
  id: projectId, organizationId: orgId, name: 'Assistenza storica', slug: 'assistenza-storica',
  description: 'Conversazioni conservate', status: 'ARCHIVED',
};
const active: Project = { ...archived, status: 'ACTIVE' };
const base = `**/api/organizations/${orgId}/projects`;
const archivedPath = `${base}/archived`;
const restorePath = `${base}/${projectId}/restore`;

async function login(page: Page) {
  await page.goto(`/#organization=${orgId}`);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await page.locator('#username').fill(process.env.DIALOGA_TEST_USERNAME || 'dialoga-test');
  await page.locator('#password').fill(process.env.DIALOGA_TEST_PASSWORD || 'dialoga-local-password');
  await page.locator('#kc-login').click();
  await expect(page.getByRole('heading', { name: org.name, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Progetti', exact: true })).toBeVisible();
}

async function openArchived(page: Page) {
  await page.getByRole('button', { name: 'Progetti archiviati', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Elenco progetti archiviati' })).toContainText(archived.name);
}

async function confirmRestore(page: Page) {
  await page.getByRole('button', { name: `Ripristina progetto ${archived.name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Conferma ripristino', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  // Il login rimane reale; le API simulate rendono deterministici errori e concorrenza UI.
  await page.route(`**/api/organizations/${orgId}`, route => route.fulfill({ json: org }));
  await page.route(base, route => route.fulfill({ json: [] }));
  await page.route(archivedPath, route => route.fulfill({ json: [archived] }));
  await page.route(`${base}/${projectId}`, route => route.fulfill({ json: active }));
  await page.route(restorePath, route => route.fulfill({ json: active }));
});

test('archives load only on demand, show metadata and refresh to an explicit empty state', async ({ page }) => {
  let reads = 0;
  let projects: ArchivedProject[] = [archived, {
    ...archived, id: '56789012-1234-4234-8234-123456789fed', name: 'Secondo archivio',
    slug: 'secondo-archivio', description: null,
  }];
  await page.route(archivedPath, route => { reads++; return route.fulfill({ json: projects }); });
  await login(page);
  await expect(page.getByRole('button', { name: 'Progetti archiviati', exact: true })).toBeVisible();
  expect(reads).toBe(0);
  await openArchived(page);
  const list = page.getByRole('list', { name: 'Elenco progetti archiviati' });
  await expect(list.locator('li')).toHaveCount(2);
  await expect(list).toContainText(archived.slug);
  await expect(list).toContainText(archived.description!);
  await expect(list).toContainText('Nessuna descrizione.');
  await expect(list.getByText('Archiviato', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Modifica progetto', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Gestisci accessi', exact: true })).toHaveCount(0);
  projects = [];
  await page.getByRole('button', { name: 'Aggiorna archiviati', exact: true }).click();
  await expect(page.getByText('Nessun progetto archiviato.', { exact: true })).toBeVisible();
  await expect(list).toHaveCount(0);
  expect(reads).toBe(2);
});

test('restore explains access consequences and cancellation performs no mutation', async ({ page }) => {
  let writes = 0;
  await page.route(restorePath, route => { writes++; return route.fulfill({ json: active }); });
  await login(page); await openArchived(page);
  await page.getByRole('button', { name: `Ripristina progetto ${archived.name}`, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Conferma ripristino', exact: true })).toBeVisible();
  await expect(page.getByText('Gli accessi revocati non saranno ripristinati.', { exact: false })).toBeVisible();
  expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Annulla ripristino', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Conferma ripristino', exact: true })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Elenco progetti archiviati' })).toContainText(archived.name);
  expect(writes).toBe(0);
});

test('double confirmation sends one POST and success rereads active detail, list and reload', async ({ page }) => {
  let restored = false, writes = 0, detailReads = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(base, route => route.fulfill({ json: restored ? [active] : [] }));
  await page.route(archivedPath, route => route.fulfill({ json: restored ? [] : [archived] }));
  await page.route(`${base}/${projectId}`, route => { detailReads++; return route.fulfill({ json: active }); });
  await page.route(restorePath, async route => {
    writes++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().postData()).toBeNull();
    await gate; restored = true;
    return route.fulfill({ json: active });
  });
  await login(page); await openArchived(page);
  await page.getByRole('button', { name: `Ripristina progetto ${archived.name}`, exact: true }).click();
  // Due eventi nello stesso turno verificano anche la guardia oltre al bottone disabilitato.
  await page.getByRole('button', { name: 'Conferma ripristino', exact: true }).evaluate((button: HTMLButtonElement) => {
    button.click(); button.click();
  });
  await expect.poll(() => writes).toBe(1);
  await expect(page.getByRole('button', { name: 'Ripristino in corso…', exact: true })).toBeDisabled();
  await expect(page.locator('.project-detail')).toHaveCount(0);
  release();
  await expect(page.getByText('Progetto ripristinato.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: active.name, exact: true })).toBeVisible();
  await expect(page.locator('.project-detail')).toContainText('Attivo');
  expect(detailReads).toBe(1);
  await expect(page).toHaveURL(new RegExp(`&project=${projectId}$`));
  await page.getByRole('button', { name: 'Torna ai progetti', exact: false }).click();
  await expect(page.locator('.project-list')).toContainText(active.name);
  await page.getByRole('button', { name: 'Progetti archiviati', exact: true }).click();
  await expect(page.getByText('Nessun progetto archiviato.', { exact: true })).toBeVisible();
  await page.locator('.project-list button').click();
  await expect(page.getByRole('heading', { name: active.name, exact: true })).toBeVisible();
  const beforeReload = detailReads;
  await page.reload();
  await expect(page.getByRole('heading', { name: active.name, exact: true })).toBeVisible();
  expect(detailReads).toBeGreaterThan(beforeReload);
  expect(writes).toBe(1);
});

test('organization admin can browse archives and restore a project', async ({ page }) => {
  await page.route(`**/api/organizations/${orgId}`, route => route.fulfill({ json: { ...org, role: 'ADMIN' } }));
  let writes = 0;
  await page.route(restorePath, route => { writes++; return route.fulfill({ json: active }); });
  await login(page); await openArchived(page); await confirmRestore(page);
  await expect(page.getByRole('heading', { name: active.name, exact: true })).toBeVisible();
  await expect(page.getByText('Progetto ripristinato.', { exact: true })).toBeVisible();
  expect(writes).toBe(1);
});

test('regular member sees assigned projects without archive controls or archive requests', async ({ page }) => {
  let archiveReads = 0;
  await page.route(`**/api/organizations/${orgId}`, route => route.fulfill({ json: { ...org, role: 'MEMBER' } }));
  await page.route(base, route => route.fulfill({ json: [active] }));
  await page.route(archivedPath, route => { archiveReads++; return route.fulfill({ json: [archived] }); });
  await login(page);
  await expect(page.locator('.project-list')).toContainText(active.name);
  await expect(page.getByRole('button', { name: 'Progetti archiviati', exact: true })).toHaveCount(0);
  await page.locator('.project-list button').click();
  await expect(page.getByRole('heading', { name: active.name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ripristina progetto', exact: false })).toHaveCount(0);
  expect(archiveReads).toBe(0);
});

for (const status of [403, 404]) {
  test(`restore ${status} clears already loaded archives despite a stale OWNER role`, async ({ page }) => {
    await page.route(restorePath, route => route.fulfill({ status, json: {} }));
    await login(page); await openArchived(page); await confirmRestore(page);
    await expect(page.getByRole('alert')).toContainText(status === 403 ? 'Solo il proprietario' : 'non è disponibile');
    await expect(page.getByRole('list', { name: 'Elenco progetti archiviati' })).toHaveCount(0);
    await expect(page.getByText(archived.description!, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Conferma ripristino', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ricarica archiviati', exact: true })).toBeVisible();
    await expect(page.getByText('Progetto ripristinato.', { exact: true })).toHaveCount(0);
    await expect(page.locator('.project-detail')).toHaveCount(0);
  });
}

test('503 loading can retry and ambiguous restore waits for a fresh list without optimistic success', async ({ page }) => {
  let failLoad = true, restoredOnServer = false, writes = 0;
  await page.route(archivedPath, route => route.fulfill(failLoad
    ? { status: 503, json: {} } : { json: restoredOnServer ? [] : [archived] }));
  await page.route(restorePath, route => {
    // Una risposta negativa può arrivare dopo il commit: la UI deve invitare alla rilettura.
    writes++; restoredOnServer = true;
    return route.fulfill({ status: 503, json: {} });
  });
  await login(page);
  await page.getByRole('button', { name: 'Progetti archiviati', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Operazione non confermata');
  await expect(page.getByText('Nessun progetto archiviato.', { exact: true })).toHaveCount(0);
  failLoad = false;
  await page.getByRole('button', { name: 'Ricarica archiviati', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Elenco progetti archiviati' })).toContainText(archived.name);
  await confirmRestore(page);
  await expect(page.getByRole('alert')).toContainText('Aggiorna gli archiviati');
  await expect(page.getByRole('list', { name: 'Elenco progetti archiviati' })).toContainText(archived.name);
  await expect(page.getByText('Progetto ripristinato.', { exact: true })).toHaveCount(0);
  await expect(page.locator('.project-detail')).toHaveCount(0);
  expect(writes).toBe(1);
  await page.getByRole('button', { name: 'Aggiorna archiviati', exact: true }).click();
  await expect(page.getByText('Nessun progetto archiviato.', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(writes).toBe(1);
});

test('restore 401 expires the session and removes the private workspace', async ({ page }) => {
  await page.route(restorePath, route => route.fulfill({ status: 401, json: {} }));
  await login(page); await openArchived(page); await confirmRestore(page);
  await expect(page.getByRole('status')).toContainText('La sessione è scaduta');
  await expect(page.getByRole('button', { name: 'Accedi', exact: true })).toBeVisible();
  await expect(page.locator('.projects-panel')).toHaveCount(0);
  await expect(page.getByText(archived.description!, { exact: true })).toHaveCount(0);
});

test('changing organization aborts an archive read and never displays its late result', async ({ page }) => {
  const otherOrgId = '67890123-1234-4234-8234-123456789abc';
  let started = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(archivedPath, async route => {
    started = true;
    await gate;
    if (!route.request().failure()) await route.fulfill({ json: [archived] });
  });
  await page.route(`**/api/organizations/${otherOrgId}`, route => route.fulfill({ json: {
    ...org, id: otherOrgId, name: 'Studio Boreale', slug: 'studio-boreale',
  } }));
  await page.route(`**/api/organizations/${otherOrgId}/projects`, route => route.fulfill({ json: [] }));
  await page.route(`**/api/organizations/${otherOrgId}/projects/archived`, route => route.fulfill({ json: [] }));
  await login(page);
  await page.getByRole('button', { name: 'Progetti archiviati', exact: true }).click();
  await expect.poll(() => started).toBe(true);
  // L'abort è osservato prima di rilasciare la vecchia lettura, evitando attese temporali arbitrarie.
  const cancelled = page.waitForEvent('requestfailed', request => request.url().endsWith(`/organizations/${orgId}/projects/archived`));
  await page.evaluate(id => { window.location.hash = `organization=${id}`; }, otherOrgId);
  await cancelled;
  await expect(page.getByRole('heading', { name: 'Studio Boreale', exact: true })).toBeVisible();
  release();
  await page.getByRole('button', { name: 'Progetti archiviati', exact: true }).click();
  await expect(page.getByText('Nessun progetto archiviato.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: archived.name, exact: true })).toHaveCount(0);
  await expect(page.getByText(archived.description!, { exact: true })).toHaveCount(0);
});
