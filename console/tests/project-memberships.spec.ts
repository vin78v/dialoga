import { expect, test, type Page } from '@playwright/test';
const orgId = '11111111-2222-4333-8444-555555555555';
const projectId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const userId = '12345678-1234-4234-8234-123456789abc';
const org = { id: orgId, name: 'Studio Aurora', slug: 'studio-aurora', role: 'OWNER' };
const project = { id: projectId, organizationId: orgId, name: 'Assistenza', slug: 'assistenza', description: null, status: 'ACTIVE' };
const member = { id: 'membership', userId, email: 'member@example.test', role: 'VIEWER', status: 'ACTIVE', organizationRole: 'MEMBER', organizationMembershipStatus: 'ACTIVE', userStatus: 'ACTIVE' };
const candidate = { id: 'org-membership', userId, email: member.email, firstName: null, lastName: null, role: 'MEMBER', status: 'ACTIVE', userStatus: 'ACTIVE' };
const path = `**/api/organizations/${orgId}/projects/${projectId}/members`;
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
  await page.route(`**/api/organizations/${orgId}/projects`, route => route.fulfill({ json: [project] }));
  await page.route(`**/api/organizations/${orgId}/projects/${projectId}`, route => route.fulfill({ json: project }));
  await page.route(`**/api/organizations/${orgId}/members`, route => route.fulfill({ json: [candidate,
    { ...candidate, id: 'admin', userId: 'admin', role: 'ADMIN' },
    { ...candidate, id: 'owner', userId: 'owner', role: 'OWNER' },
    { ...candidate, id: 'suspended', userId: 'suspended', status: 'SUSPENDED' },
    { ...candidate, id: 'disabled', userId: 'disabled', userStatus: 'SUSPENDED' },
  ] }));
  await page.route(path, route => route.fulfill({ json: [] }));
});

test('assigns an active regular member once and excludes implicit or inactive accounts', async ({ page }) => {
  let requests = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${path}/${userId}`, async route => {
    requests++;
    expect(route.request().method()).toBe('PUT');
    expect(route.request().postDataJSON()).toEqual({ role: 'VIEWER' });
    await gate; return route.fulfill({ json: member });
  });
  await login(page); await page.getByRole('button', { name: 'Gestisci accessi', exact: true }).click();
  await expect(page.locator('#project-member-user option')).toHaveCount(2);
  await page.getByLabel('Membro dell’organizzazione', { exact: true }).selectOption(userId);
  await expect(page.getByLabel('Ruolo nel progetto', { exact: true })).toHaveValue('VIEWER');
  await page.locator('.project-members-panel form').evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect.poll(() => requests).toBe(1);
  await expect(page.getByRole('button', { name: 'Salvataggio in corso…' })).toBeDisabled(); release();
  await expect(page.getByRole('list', { name: 'Assegnazioni al progetto' })).toContainText(member.email);
  await expect(page.getByRole('status')).toContainText('Accesso salvato');
});

test('loads the existing role before editing and warns about additional permissions', async ({ page }) => {
  await page.route(path, route => route.fulfill({ json: [{ ...member, role: 'EDITOR' }] }));
  await page.route(`${path}/${userId}`, route => {
    expect(route.request().postDataJSON()).toEqual({ role: 'OPERATOR' });
    return route.fulfill({ json: { ...member, role: 'OPERATOR' } });
  });
  await login(page); await page.getByRole('button', { name: 'Gestisci accessi' }).click();
  await page.getByRole('button', { name: `Modifica ruolo per ${member.email}` }).click();
  await expect(page.getByLabel('Ruolo nel progetto', { exact: true })).toHaveValue('EDITOR');
  await page.getByLabel('Ruolo nel progetto', { exact: true }).selectOption('OPERATOR');
  await expect(page.getByText('Il cambio o ripristino dell’accesso rimuove i permessi aggiuntivi precedenti.')).toBeVisible();
  await page.getByRole('button', { name: 'Salva accesso', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Assegnazioni al progetto' })).toContainText('OPERATOR');
});

test('revocation waits for confirmation and then marks access inactive', async ({ page }) => {
  let removals = 0;
  await page.route(path, route => route.fulfill({ json: [member] }));
  await page.route(`${path}/${userId}`, route => { expect(route.request().method()).toBe('DELETE'); removals++; return route.fulfill({ status: 204 }); });
  await login(page); await page.getByRole('button', { name: 'Gestisci accessi' }).click();
  await page.getByRole('button', { name: `Rimuovi accesso per ${member.email}` }).click();
  await expect(page.getByRole('button', { name: 'Conferma rimozione' })).toBeVisible(); expect(removals).toBe(0);
  await page.getByRole('button', { name: 'Conferma rimozione' }).click();
  await expect(page.getByRole('list', { name: 'Assegnazioni al progetto' })).toContainText('Non attivo');
  await expect(page.getByRole('button', { name: `Rimuovi accesso per ${member.email}` })).toHaveCount(0);
  expect(removals).toBe(1);
});

test('project manager without organization authority cannot open management controls', async ({ page }) => {
  await page.route(`**/api/organizations/${orgId}`, route => route.fulfill({ json: { ...org, role: 'MEMBER' } }));
  await login(page);
  await expect(page.getByRole('button', { name: 'Gestisci accessi' })).toHaveCount(0);
});

test('denial from the server clears previously loaded team data', async ({ page }) => {
  await page.route(path, route => route.fulfill({ json: [member] }));
  await page.route(`${path}/${userId}`, route => route.fulfill({ status: 403, json: {} }));
  await login(page); await page.getByRole('button', { name: 'Gestisci accessi' }).click();
  await page.getByLabel('Membro dell’organizzazione', { exact: true }).selectOption(userId);
  await page.getByRole('button', { name: 'Salva accesso', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Solo OWNER e ADMIN');
  await expect(page.getByRole('list', { name: 'Assegnazioni al progetto' })).toHaveCount(0);
  await expect(page.getByLabel('Membro dell’organizzazione', { exact: true })).toHaveCount(0);
});

test('loading errors can be retried without inventing an empty assignment list', async ({ page }) => {
  let fail = true;
  await page.route(path, route => route.fulfill({ status: fail ? 503 : 200, json: fail ? {} : [member] }));
  await login(page); await page.getByRole('button', { name: 'Gestisci accessi' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salva accesso', exact: true })).toHaveCount(0);
  fail = false; await page.getByRole('button', { name: 'Ricarica accessi' }).click();
  await expect(page.getByRole('list', { name: 'Assegnazioni al progetto' })).toContainText(member.email);
});

test('inactive target conflict preserves the selection without adding an assignment', async ({ page }) => {
  await page.route(`${path}/${userId}`, route => route.fulfill({ status: 409, json: {} }));
  await login(page); await page.getByRole('button', { name: 'Gestisci accessi' }).click();
  await page.getByLabel('Membro dell’organizzazione', { exact: true }).selectOption(userId);
  await page.getByRole('button', { name: 'Salva accesso', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('membro attivo');
  await expect(page.getByLabel('Membro dell’organizzazione', { exact: true })).toHaveValue(userId);
  await expect(page.getByRole('list', { name: 'Assegnazioni al progetto' })).toHaveCount(0);
});

test('a 401 during assignment removes the private workspace', async ({ page }) => {
  await page.route(`${path}/${userId}`, route => route.fulfill({ status: 401, json: {} }));
  await login(page); await page.getByRole('button', { name: 'Gestisci accessi' }).click();
  await page.getByLabel('Membro dell’organizzazione', { exact: true }).selectOption(userId);
  await page.getByRole('button', { name: 'Salva accesso', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('La sessione è scaduta');
  await expect(page.getByRole('button', { name: 'Accedi', exact: true })).toBeVisible();
  await expect(page.locator('.project-members-panel')).toHaveCount(0);
});
