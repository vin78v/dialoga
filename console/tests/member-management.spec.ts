import { expect, test, type Page } from '@playwright/test';
import type { Member } from '../src/team';
const orgId = '22222222-3333-4444-8555-666666666666';
const org = { id: orgId, name: 'Studio Aurora', slug: 'studio-aurora', role: 'OWNER' };
const owner: Member = { id: 'owner-membership', userId: '22222222-3333-4444-8555-666666666601', email: 'owner@example.test', firstName: null, lastName: null, role: 'OWNER', status: 'ACTIVE', userStatus: 'ACTIVE' };
const member: Member = { ...owner, id: 'regular-membership', userId: '22222222-3333-4444-8555-666666666602', email: 'member@example.test', role: 'MEMBER' };
const admin: Member = { ...owner, id: 'admin-membership', userId: '22222222-3333-4444-8555-666666666603', email: 'admin@example.test', role: 'ADMIN' };
const base = `**/api/organizations/${orgId}`;
async function login(page: Page, team = true) {
  await page.goto(`/#organization=${orgId}`);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await page.locator('#username').fill(process.env.DIALOGA_TEST_USERNAME || 'dialoga-test');
  await page.locator('#password').fill(process.env.DIALOGA_TEST_PASSWORD || 'dialoga-local-password');
  await page.locator('#kc-login').click();
  await expect(page.getByRole('heading', { name: org.name, exact: true })).toBeVisible();
  if (team) { await page.getByRole('button', { name: 'Membri e inviti' }).click(); await expect(page.getByRole('list', { name: 'Membri dell’organizzazione' })).toBeVisible(); }
}
test.beforeEach(async ({ page }) => {
  await page.route('**/api/me', route => route.fulfill({ json: { id: owner.userId, email: owner.email, firstName: null, lastName: null } }));
  await page.route(base, route => route.fulfill({ json: org }));
  await page.route(`${base}/projects`, route => route.fulfill({ json: [] }));
  await page.route(`${base}/members`, route => route.fulfill({ json: [owner, admin, member] }));
  await page.route(`${base}/invites`, route => route.fulfill({ json: [] }));
});

test('owner promotes after confirmation with a single PUT and refreshes team', async ({ page }) => {
  let updated = member, writes = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${base}/members`, route => route.fulfill({ json: [owner, admin, updated] }));
  await page.route(`${base}/members/${member.userId}/role`, async route => {
    writes++; expect(route.request().method()).toBe('PUT'); expect(route.request().postDataJSON()).toEqual({ role: 'OWNER' });
    await gate; updated = { ...member, role: 'OWNER' }; return route.fulfill({ json: updated });
  });
  await login(page); await page.getByRole('button', { name: `Cambia ruolo per ${member.email}`, exact: true }).click();
  await expect(page.getByLabel('Nuovo ruolo nell’organizzazione')).toHaveValue('MEMBER');
  await page.getByLabel('Nuovo ruolo nell’organizzazione').selectOption('OWNER');
  await expect(page.locator('.member-change')).toContainText('revoca gli inviti pendenti'); expect(writes).toBe(0);
  await page.locator('.member-change').evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect.poll(() => writes).toBe(1); await expect(page.getByRole('button', { name: 'Aggiornamento in corso…' })).toBeDisabled(); release();
  await expect(page.getByRole('list', { name: 'Membri dell’organizzazione' }).locator('li').filter({ hasText: member.email })).toContainText('OWNER · Attivo');
  await expect(page.getByText('Membro aggiornato.', { exact: true })).toBeVisible();
});

test('suspension requires confirmation, supports cancel, and reactivation explains project reassignment', async ({ page }) => {
  let updated = member, writes = 0;
  await page.route(`${base}/members`, route => route.fulfill({ json: [owner, updated] }));
  await page.route(`${base}/members/${member.userId}/status`, route => {
    writes++; updated = { ...member, status: route.request().postDataJSON().status }; return route.fulfill({ json: updated });
  });
  await login(page); await page.getByRole('button', { name: `Sospendi membro ${member.email}`, exact: true }).click();
  expect(writes).toBe(0); await page.getByRole('button', { name: 'Annulla modifica membro' }).click(); expect(writes).toBe(0);
  await page.getByRole('button', { name: `Sospendi membro ${member.email}`, exact: true }).click();
  await page.getByRole('button', { name: 'Conferma modifica membro' }).click();
  await page.getByRole('button', { name: `Riattiva membro ${member.email}`, exact: true }).click();
  await expect(page.locator('.member-change')).toContainText('non saranno ripristinati');
  await page.getByRole('button', { name: 'Conferma modifica membro' }).click();
  await expect(page.getByRole('button', { name: `Sospendi membro ${member.email}`, exact: true })).toBeVisible(); expect(writes).toBe(2);
});

test('admin sees status actions only for regular members; member sees no team controls', async ({ page }) => {
  await page.route(base, route => route.fulfill({ json: { ...org, role: 'ADMIN' } }));
  await page.route('**/api/me', route => route.fulfill({ json: { id: admin.userId, email: admin.email } }));
  await login(page);
  await expect(page.getByRole('button', { name: 'Cambia ruolo per', exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Sospendi membro ${owner.email}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Sospendi membro ${admin.email}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Sospendi membro ${member.email}`, exact: true })).toBeVisible();
  await page.route(base, route => route.fulfill({ json: { ...org, role: 'MEMBER' } })); await page.reload();
  await expect(page.getByRole('heading', { name: org.name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Membri e inviti' })).toHaveCount(0);
});

test('self suspension hidden and last-owner conflict preserves role and selected change', async ({ page }) => {
  await page.route(`${base}/members/${owner.userId}/role`, route => route.fulfill({ status: 409, json: {} }));
  await login(page);
  await expect(page.getByRole('button', { name: `Sospendi membro ${owner.email}`, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: `Cambia ruolo per ${owner.email}`, exact: true }).click();
  await page.getByLabel('Nuovo ruolo nell’organizzazione').selectOption('MEMBER');
  await page.getByRole('button', { name: 'Conferma modifica membro' }).click();
  await expect(page.getByRole('alert')).toContainText('deve restare un OWNER attivo');
  await expect(page.getByLabel('Nuovo ruolo nell’organizzazione')).toHaveValue('MEMBER');
  await expect(page.getByRole('list', { name: 'Membri dell’organizzazione' }).locator('li').filter({ hasText: owner.email })).toContainText('OWNER · Attivo');
});

test('successful self demotion reloads organization and removes privileged controls', async ({ page }) => {
  let demoted = false;
  await page.route(base, route => route.fulfill({ json: { ...org, role: demoted ? 'MEMBER' : 'OWNER' } }));
  await page.route(`${base}/members/${owner.userId}/role`, route => { demoted = true; return route.fulfill({ json: { ...owner, role: 'MEMBER' } }); });
  await login(page); await page.getByRole('button', { name: `Cambia ruolo per ${owner.email}`, exact: true }).click();
  await page.getByLabel('Nuovo ruolo nell’organizzazione').selectOption('MEMBER');
  await page.getByRole('button', { name: 'Conferma modifica membro' }).click();
  await expect(page.locator('.organization-details')).toContainText('MEMBER');
  await expect(page.getByRole('button', { name: 'Membri e inviti' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nuovo progetto' })).toHaveCount(0);
});

for (const status of [403, 404]) test(`mutation ${status} removes loaded member data and controls`, async ({ page }) => {
  await page.route(`${base}/members/${member.userId}/status`, route => route.fulfill({ status, json: {} }));
  await login(page); await page.getByRole('button', { name: `Sospendi membro ${member.email}`, exact: true }).click();
  await page.getByRole('button', { name: 'Conferma modifica membro' }).click();
  await expect(page.getByRole('alert')).toContainText(status === 403 ? 'permessi' : 'non è più disponibile');
  await expect(page.getByRole('list', { name: 'Membri dell’organizzazione' })).toHaveCount(0);
  await expect(page.getByLabel('Email del destinatario')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ricarica team' })).toBeVisible();
});

test('network failure retains selection without optimistic changes and can reload', async ({ page }) => {
  await page.route(`${base}/members/${member.userId}/role`, route => route.fulfill({ status: 503, json: {} }));
  await login(page); await page.getByRole('button', { name: `Cambia ruolo per ${member.email}`, exact: true }).click();
  await page.getByLabel('Nuovo ruolo nell’organizzazione').selectOption('ADMIN');
  await page.getByRole('button', { name: 'Conferma modifica membro' }).click();
  await expect(page.getByRole('alert')).toContainText('Modifica non confermata');
  await expect(page.getByLabel('Nuovo ruolo nell’organizzazione')).toHaveValue('ADMIN');
  await expect(page.getByRole('list', { name: 'Membri dell’organizzazione' }).locator('li').filter({ hasText: member.email })).toContainText('MEMBER · Attivo');
  await page.getByRole('button', { name: 'Aggiorna team' }).click();
  await expect(page.locator('.member-change')).toHaveCount(0);
});

test('inactive accounts cannot be promoted or reactivated from the console', async ({ page }) => {
  await page.route(`${base}/members`, route => route.fulfill({ json: [owner, { ...member, status: 'SUSPENDED', userStatus: 'SUSPENDED' }] }));
  await login(page);
  await expect(page.getByText('Account globale non attivo')).toBeVisible();
  await expect(page.getByRole('button', { name: `Cambia ruolo per ${member.email}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Riattiva membro ${member.email}`, exact: true })).toHaveCount(0);
});

test('mutation 401 clears private workspace', async ({ page }) => {
  await page.route(`${base}/members/${member.userId}/status`, route => route.fulfill({ status: 401, json: {} }));
  await login(page); await page.getByRole('button', { name: `Sospendi membro ${member.email}`, exact: true }).click();
  await page.getByRole('button', { name: 'Conferma modifica membro' }).click();
  await expect(page.getByRole('status')).toContainText('La sessione è scaduta');
  await expect(page.getByRole('button', { name: 'Accedi', exact: true })).toBeVisible();
  await expect(page.locator('.organization-panel')).toHaveCount(0);
});

test('reactivated member can reopen the same organization link after an access denial', async ({ page }) => {
  let active = true;
  await page.route(base, route => route.fulfill(active ? { json: { ...org, role: 'MEMBER' } } : { status: 404, json: {} }));
  await login(page, false);
  active = false; await page.reload();
  await expect(page.getByRole('heading', { name: 'Crea la tua organizzazione', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('non hai più accesso');
  active = true;
  await page.evaluate(id => { window.location.hash = `organization=${id}`; }, orgId);
  await expect(page.getByRole('heading', { name: org.name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Membri e inviti' })).toHaveCount(0);
});
