import { expect, test, type Page } from '@playwright/test';

const orgId = '67890123-1234-4234-8234-123456789abc';
const projectId = '67890123-1234-4234-8234-123456789def';
const assistantId = '67890123-1234-4234-8234-123456789123';
const org = { id: orgId, name: 'Studio Aurora', slug: 'studio-aurora', role: 'OWNER' };
const project = { id: projectId, organizationId: orgId, name: 'Assistenza clienti', slug: 'assistenza-clienti', description: null, status: 'ACTIVE' };
const draft = { id: assistantId, organizationId: orgId, projectId, name: 'Assistente clienti', status: 'DRAFT', draftLockVersion: 3 };
const detail = { ...draft, instructions: 'Rispondi in italiano alle richieste dei clienti.', welcomeMessage: 'Come posso aiutarti?', canEdit: true };
const path = `**/api/organizations/${orgId}/projects/${projectId}/assistants`;
const assistantPath = `${path}/${assistantId}`;

// Keycloak resta reale; intercettiamo solo le API per riprodurre conflitti e revoche deterministici.
async function login(page: Page) {
  await page.goto(`/#organization=${orgId}&project=${projectId}`);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await page.locator('#username').fill(process.env.DIALOGA_TEST_USERNAME || 'dialoga-test');
  await page.locator('#password').fill(process.env.DIALOGA_TEST_PASSWORD || 'dialoga-local-password');
  await page.locator('#kc-login').click();
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
}
async function openAssistants(page: Page) {
  await page.getByRole('button', { name: 'Assistenti', exact: true }).click();
}
async function openDraft(page: Page) {
  await openAssistants(page);
  await page.getByRole('button', { name: `Apri assistente ${draft.name}`, exact: true }).click();
  await expect(page.locator('.assistant-detail')).toContainText(detail.instructions);
}
async function fillCreation(page: Page, name = draft.name) {
  await page.getByRole('button', { name: 'Nuovo assistente', exact: true }).click();
  await page.getByLabel('Nome dell’assistente', { exact: true }).fill(name);
  await page.getByLabel('Istruzioni dell’assistente', { exact: true }).fill(detail.instructions);
}

test.beforeEach(async ({ page }) => {
  await page.route(`**/api/organizations/${orgId}`, route => route.fulfill({ json: org }));
  await page.route(`**/api/organizations/${orgId}/projects`, route => route.fulfill({ json: [project] }));
  await page.route(`**/api/organizations/${orgId}/projects/${projectId}`, route => route.fulfill({ json: project }));
  await page.route(path, route => route.fulfill({ json: { canEdit: true, items: [draft] } }));
  await page.route(assistantPath, route => route.fulfill({ json: detail }));
});

test('loads assistants only on request and reads a persisted draft after reopening the project', async ({ page }) => {
  let lists = 0, reads = 0;
  await page.route(path, route => { lists++; return route.fulfill({ json: { canEdit: true, items: [draft] } }); });
  await page.route(assistantPath, route => { reads++; return route.fulfill({ json: detail }); });
  await login(page);
  expect(lists).toBe(0); expect(reads).toBe(0);
  await openDraft(page);
  await expect(page.locator('.assistant-detail')).toContainText('Bozza');
  await expect(page.getByText('La bozza non è pubblicata e non risponde ancora in chat.', { exact: true })).toBeVisible();
  await expect(page.locator('.assistant-detail')).toContainText(detail.welcomeMessage);
  await page.getByRole('button', { name: 'Torna agli assistenti', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Elenco assistenti' })).toContainText(draft.name);
  await page.reload();
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
  expect(lists).toBe(1); expect(reads).toBe(1);
  await openDraft(page);
  expect(lists).toBe(2); expect(reads).toBe(2);
});

test('creates once, trims the payload and exposes the persisted draft in the list', async ({ page }) => {
  let created = false, posts = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(path, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { canEdit: true, items: created ? [draft] : [] } });
    posts++;
    expect(route.request().postDataJSON()).toEqual({ name: draft.name, instructions: detail.instructions, welcomeMessage: null });
    await gate; created = true;
    return route.fulfill({ status: 201, json: { ...detail, welcomeMessage: null } });
  });
  await login(page); await openAssistants(page);
  await fillCreation(page, `  ${draft.name}  `);
  await page.getByLabel('Istruzioni dell’assistente', { exact: true }).fill(`  ${detail.instructions}  `);
  await page.getByLabel('Messaggio iniziale (facoltativo)', { exact: true }).fill('   ');
  // Due submit nello stesso turno verificano anche la guardia sincrona, prima del nuovo render.
  await page.locator('.assistant-form').evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect.poll(() => posts).toBe(1);
  await expect(page.locator('.assistant-form button[type="submit"]')).toBeDisabled();
  release();
  await expect(page.locator('.assistant-detail')).toContainText(detail.instructions);
  await page.getByRole('button', { name: 'Torna agli assistenti', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Elenco assistenti' })).toContainText(draft.name);
  await page.getByRole('button', { name: `Apri assistente ${draft.name}`, exact: true }).click();
  await expect(page.locator('.assistant-detail')).toContainText(detail.instructions);
  expect(posts).toBe(1);
});

test('saves a draft once with its version and refreshes the list and persisted detail', async ({ page }) => {
  let saved = detail, writes = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(path, route => route.fulfill({ json: { canEdit: true, items: [{ ...draft, name: saved.name, draftLockVersion: saved.draftLockVersion }] } }));
  await page.route(assistantPath, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: saved });
    writes++;
    expect(route.request().method()).toBe('PUT');
    expect(route.request().postDataJSON()).toEqual({ name: 'Assistente aggiornato', instructions: 'Nuove istruzioni.', welcomeMessage: 'Benvenuto.', expectedVersion: 3 });
    await gate;
    saved = { ...detail, name: 'Assistente aggiornato', instructions: 'Nuove istruzioni.', welcomeMessage: 'Benvenuto.', draftLockVersion: 4 };
    return route.fulfill({ json: saved });
  });
  await login(page); await openDraft(page);
  await page.getByRole('button', { name: 'Modifica bozza', exact: true }).click();
  await expect(page.getByLabel('Nome dell’assistente', { exact: true })).toHaveValue(detail.name);
  await expect(page.getByLabel('Istruzioni dell’assistente', { exact: true })).toHaveValue(detail.instructions);
  await page.getByLabel('Nome dell’assistente', { exact: true }).fill('  Assistente aggiornato  ');
  await page.getByLabel('Istruzioni dell’assistente', { exact: true }).fill('Nuove istruzioni.');
  await page.getByLabel('Messaggio iniziale (facoltativo)', { exact: true }).fill('Benvenuto.');
  await page.locator('.assistant-form').evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect.poll(() => writes).toBe(1);
  await expect(page.locator('.assistant-form button[type="submit"]')).toBeDisabled(); release();
  await expect(page.locator('.assistant-detail')).toContainText('Nuove istruzioni.');
  await page.getByRole('button', { name: 'Torna agli assistenti', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Elenco assistenti' })).toContainText(saved.name);
  await page.getByRole('button', { name: `Apri assistente ${saved.name}`, exact: true }).click();
  await expect(page.locator('.assistant-detail')).toContainText('Nuove istruzioni.'); expect(writes).toBe(1);
});

test('uses server capabilities even with a stale OWNER role and keeps published assistants read only', async ({ page }) => {
  let canEdit = false;
  const published = { ...draft, id: '67890123-1234-4234-8234-123456789456', name: 'Assistente pubblicato', status: 'PUBLISHED' };
  await page.route(path, route => route.fulfill({ json: { canEdit, items: [draft, published] } }));
  await page.route(assistantPath, route => route.fulfill({ json: { ...detail, canEdit: false } }));
  await page.route(`${path}/${published.id}`, route => route.fulfill({ json: { ...detail, ...published, canEdit: false } }));
  await login(page); await openDraft(page);
  await expect(page.getByRole('button', { name: 'Modifica bozza', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Torna agli assistenti', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nuovo assistente', exact: true })).toHaveCount(0);
  canEdit = true;
  await page.getByRole('button', { name: 'Aggiorna assistenti', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nuovo assistente', exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Apri assistente ${published.name}`, exact: true }).click();
  await expect(page.locator('.assistant-detail')).toContainText(published.name);
  await expect(page.getByRole('button', { name: 'Modifica bozza', exact: true })).toHaveCount(0);
});

test('allows a regular organization member to manage drafts when the server grants edit capability', async ({ page }) => {
  await page.route(`**/api/organizations/${orgId}`, route => route.fulfill({ json: { ...org, role: 'MEMBER' } }));
  await login(page); await openAssistants(page);
  await expect(page.getByRole('button', { name: 'Nuovo assistente', exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Apri assistente ${draft.name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Modifica bozza', exact: true }).click();
  await expect(page.getByLabel('Istruzioni dell’assistente', { exact: true })).toHaveValue(detail.instructions);
  await page.getByLabel('Istruzioni dell’assistente', { exact: true }).fill('Modifica da scartare.');
  await page.getByRole('button', { name: 'Annulla modifica', exact: true }).click();
  await expect(page.locator('.assistant-detail')).toContainText(detail.instructions);
  await page.getByRole('button', { name: 'Modifica bozza', exact: true }).click();
  await expect(page.getByLabel('Istruzioni dell’assistente', { exact: true })).toHaveValue(detail.instructions);
});

test('preserves conflicting edits and discards them only after an explicit version reload', async ({ page }) => {
  let current = detail, reads = 0, writes = 0;
  await page.route(assistantPath, route => {
    if (route.request().method() === 'GET') { reads++; return route.fulfill({ json: current }); }
    writes++; expect(route.request().postDataJSON().expectedVersion).toBe(3);
    current = { ...detail, instructions: 'Testo salvato da un altro utente.', draftLockVersion: 4 };
    return route.fulfill({ status: 409, json: {} });
  });
  await login(page); await openDraft(page);
  await page.getByRole('button', { name: 'Modifica bozza', exact: true }).click();
  await page.getByLabel('Istruzioni dell’assistente', { exact: true }).fill('Il mio testo non deve sparire.');
  await page.getByRole('button', { name: 'Salva bozza', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Il testo inserito è conservato');
  await expect(page.getByLabel('Istruzioni dell’assistente', { exact: true })).toHaveValue('Il mio testo non deve sparire.');
  await expect(page.getByRole('button', { name: 'Salva bozza', exact: true })).toBeDisabled();
  expect(reads).toBe(1); expect(writes).toBe(1);
  await page.getByRole('button', { name: 'Ricarica e scarta modifiche', exact: true }).click();
  await expect(page.locator('.assistant-detail')).toContainText(current.instructions);
  await expect(page.locator('.assistant-form')).toHaveCount(0);
  expect(reads).toBe(2); expect(writes).toBe(1);
});

test('retains the original edit version when collapsing and reopening rereads a newer draft', async ({ page }) => {
  let reads = 0, writes = 0;
  await page.route(assistantPath, route => {
    if (route.request().method() === 'GET') {
      reads++;
      return route.fulfill({ json: reads === 1
        ? { ...detail, draftLockVersion: 0 }
        : { ...detail, instructions: 'Versione aggiornata da un collega.', draftLockVersion: 1 } });
    }
    writes++;
    // La versione deve restare legata al testo aperto, anche dopo una rilettura in background.
    expect(route.request().postDataJSON()).toEqual({
      name: detail.name,
      instructions: 'Testo locale ancora basato sulla versione zero.',
      welcomeMessage: detail.welcomeMessage,
      expectedVersion: 0,
    });
    return route.fulfill({ status: 409, json: {} });
  });
  await login(page); await openDraft(page);
  await page.getByRole('button', { name: 'Modifica bozza', exact: true }).click();
  await page.getByLabel('Istruzioni dell’assistente', { exact: true }).fill('Testo locale ancora basato sulla versione zero.');
  await page.getByRole('button', { name: 'Assistenti', exact: true }).click();
  await expect(page.locator('.assistant-form')).toHaveCount(0);
  const reloaded = page.waitForResponse(response => response.url().endsWith(`/assistants/${assistantId}`) && response.request().method() === 'GET');
  await page.getByRole('button', { name: 'Assistenti', exact: true }).click();
  expect((await (await reloaded).json()).draftLockVersion).toBe(1);
  await expect(page.getByLabel('Istruzioni dell’assistente', { exact: true })).toHaveValue('Testo locale ancora basato sulla versione zero.');
  await page.getByRole('button', { name: 'Salva bozza', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Il testo inserito è conservato');
  await expect(page.getByLabel('Istruzioni dell’assistente', { exact: true })).toHaveValue('Testo locale ancora basato sulla versione zero.');
  await expect(page.getByRole('button', { name: 'Salva bozza', exact: true })).toBeDisabled();
  expect(reads).toBe(2); expect(writes).toBe(1);
});

test('blocks whitespace locally and retains validated input after a server 400', async ({ page }) => {
  let posts = 0;
  await page.route(path, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { canEdit: true, items: [] } });
    posts++; return route.fulfill({ status: 400, json: {} });
  });
  await login(page); await openAssistants(page); await fillCreation(page, '   ');
  await page.getByRole('button', { name: 'Crea assistente', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible(); expect(posts).toBe(0);
  await page.getByLabel('Nome dell’assistente', { exact: true }).fill(draft.name);
  await page.getByRole('button', { name: 'Crea assistente', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Controlla nome, istruzioni');
  await expect(page.getByLabel('Nome dell’assistente', { exact: true })).toHaveValue(draft.name);
  await expect(page.getByLabel('Istruzioni dell’assistente', { exact: true })).toHaveValue(detail.instructions);
  await expect(page.locator('.assistant-detail')).toHaveCount(0); expect(posts).toBe(1);
  await page.getByRole('button', { name: 'Annulla creazione', exact: true }).click();
  await expect(page.locator('.assistant-form')).toHaveCount(0);
});

test('a denied save removes previously loaded content and the stale edit form', async ({ page }) => {
  await page.route(assistantPath, route => route.fulfill(route.request().method() === 'GET' ? { json: detail } : { status: 403, json: {} }));
  await login(page); await openDraft(page);
  await page.getByRole('button', { name: 'Modifica bozza', exact: true }).click();
  await page.getByRole('button', { name: 'Salva bozza', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Non hai più il permesso');
  await expect(page.locator('.assistant-detail')).toHaveCount(0);
  await expect(page.locator('.assistant-form')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Elenco assistenti' })).toHaveCount(0);
  await expect(page.getByText(detail.instructions, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ricarica assistenti', exact: true })).toBeVisible();
});

test('an unavailable detail removes stale content and reloads the server list before reopening', async ({ page }) => {
  let missing = true;
  await page.route(assistantPath, route => route.fulfill(missing ? { status: 404, json: {} } : { json: detail }));
  await login(page); await openAssistants(page);
  await page.getByRole('button', { name: `Apri assistente ${draft.name}`, exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('non è più disponibile o accessibile');
  await expect(page.locator('.assistant-detail')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Elenco assistenti' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Modifica bozza', exact: true })).toHaveCount(0);
  missing = false;
  await page.getByRole('button', { name: 'Ricarica assistenti', exact: true }).click();
  await page.getByRole('button', { name: `Apri assistente ${draft.name}`, exact: true }).click();
  await expect(page.locator('.assistant-detail')).toContainText(detail.instructions);
});

test('an expired session during draft save clears the private workspace', async ({ page }) => {
  await page.route(assistantPath, route => route.fulfill(route.request().method() === 'GET' ? { json: detail } : { status: 401, json: {} }));
  await login(page); await openDraft(page);
  await page.getByRole('button', { name: 'Modifica bozza', exact: true }).click();
  await page.getByRole('button', { name: 'Salva bozza', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('La sessione è scaduta');
  await expect(page.getByRole('button', { name: 'Accedi', exact: true })).toBeVisible();
  await expect(page.locator('.projects-panel')).toHaveCount(0);
});

test('a failed list read offers a retry without inventing an empty list or create controls', async ({ page }) => {
  let fail = true;
  await page.route(path, route => fail ? route.abort('failed') : route.fulfill({ json: { canEdit: true, items: [draft] } }));
  await login(page); await openAssistants(page);
  await expect(page.getByRole('alert')).toContainText('Non è stato possibile caricare gli assistenti');
  await expect(page.getByRole('list', { name: 'Elenco assistenti' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nuovo assistente', exact: true })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Ricarica assistenti', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Elenco assistenti' })).toContainText(draft.name);
});

test('an ambiguous create retains input and reloads the server list without automatically posting again', async ({ page }) => {
  let posts = 0, created = false;
  await page.route(path, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { canEdit: true, items: created ? [draft] : [] } });
    // Il server può aver salvato prima dell’errore: un retry automatico creerebbe un duplicato.
    posts++; created = true; return route.fulfill({ status: 503, json: {} });
  });
  await login(page); await openAssistants(page); await fillCreation(page);
  await page.getByRole('button', { name: 'Crea assistente', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Creazione non confermata');
  await expect(page.getByLabel('Nome dell’assistente', { exact: true })).toHaveValue(draft.name);
  await expect(page.locator('.assistant-detail')).toHaveCount(0); expect(posts).toBe(1);
  await page.getByRole('button', { name: 'Aggiorna assistenti', exact: true }).click();
  await expect(page.locator('.assistant-form')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Elenco assistenti' })).toContainText(draft.name);
  expect(posts).toBe(1);
});
