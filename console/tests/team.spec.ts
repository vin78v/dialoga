import { expect, test, type Page } from '@playwright/test';
const orgId = '11111111-2222-4333-8444-555555555555';
const inviteId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const token = 'A'.repeat(43); // Synthetic token, never a real invitation.
const org = { id: orgId, name: 'Studio Aurora', slug: 'studio-aurora', role: 'OWNER' };
const invite = { id: inviteId, organizationId: orgId, email: 'new@example.test', role: 'MEMBER', status: 'PENDING', expiresAt: '2099-01-01T00:00:00Z', createdAt: '2026-10-19T00:00:00Z' };
const member = { id: 'member', userId: 'user', email: 'owner@example.test', firstName: null, lastName: null, role: 'OWNER', status: 'ACTIVE', userStatus: 'ACTIVE' };
const base = `**/api/organizations/${orgId}`;
const invitePath = `/#organization=${orgId}&invite=${inviteId}&token=${token}`;
async function login(page: Page, path = `/#organization=${orgId}`) {
  await page.goto(path);
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await page.locator('#username').fill(process.env.DIALOGA_TEST_USERNAME || 'dialoga-test');
  await page.locator('#password').fill(process.env.DIALOGA_TEST_PASSWORD || 'dialoga-local-password');
  await page.locator('#kc-login').click();
}
test.beforeEach(async ({ page }) => {
  await page.route(base, route => route.fulfill({ json: org }));
  await page.route(`${base}/projects`, route => route.fulfill({ json: [] }));
  await page.route(`${base}/members`, route => route.fulfill({ json: [member] }));
  await page.route(`${base}/invites`, route => route.fulfill({ json: [] }));
});

test('owner generates once, copies a link and revokes it without sending email', async ({ page, context }) => {
  let posts = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${base}/invites`, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    posts++;
    expect(route.request().postDataJSON()).toEqual({ email: 'new@example.test', role: 'MEMBER' });
    await gate; return route.fulfill({ status: 201, json: { invite, token } });
  });
  await page.route(`${base}/invites/${inviteId}`, route => { expect(route.request().method()).toBe('DELETE'); return route.fulfill({ status: 204 }); });
  await login(page);
  await page.getByRole('button', { name: 'Membri e inviti' }).click();
  await expect(page.getByRole('list', { name: 'Membri dell’organizzazione' })).toContainText(member.email);
  await page.getByLabel('Email del destinatario').fill('new@example.test');
  await page.locator('.members-panel form').evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect.poll(() => posts).toBe(1); release();
  await expect(page.getByLabel('Link d’invito')).toHaveValue(new RegExp(`token=${token}$`));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copia link' }).click();
  await expect(page.getByRole('status')).toHaveText('Link copiato.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`token=${token}`);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(token);
  await page.getByRole('button', { name: 'Revoca invito per new@example.test' }).click();
  await expect(page.getByRole('list', { name: 'Inviti dell’organizzazione' })).toContainText('Revocato');
  await expect(page.getByLabel('Link d’invito')).toHaveCount(0);
});

test('admin cannot select ADMIN and member has no team-management action', async ({ page }) => {
  await page.route(base, route => route.fulfill({ json: { ...org, role: 'ADMIN' } }));
  await login(page); await page.getByRole('button', { name: 'Membri e inviti' }).click();
  await expect(page.locator('#invite-role option')).toHaveCount(1);
  await page.route(base, route => route.fulfill({ json: { ...org, role: 'MEMBER' } }));
  await page.reload();
  await expect(page.getByRole('heading', { name: org.name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Membri e inviti' })).toHaveCount(0);
});

test('duplicate invite keeps recipient and does not invent a recoverable link', async ({ page }) => {
  await page.route(`${base}/invites`, route => route.fulfill(route.request().method() === 'GET' ? { json: [invite] } : { status: 409, json: {} }));
  await login(page); await page.getByRole('button', { name: 'Membri e inviti' }).click();
  await page.getByLabel('Email del destinatario').fill(invite.email);
  await page.getByRole('button', { name: 'Genera invito' }).click();
  await expect(page.getByRole('alert')).toContainText('già un invito');
  await expect(page.getByLabel('Email del destinatario')).toHaveValue(invite.email);
  await expect(page.getByLabel('Link d’invito')).toHaveCount(0);
});

test('link survives login, strips secret from history and accepts once on explicit action', async ({ page }) => {
  let posts = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${base}/invites/${inviteId}/accept`, async route => {
    posts++; expect(route.request().postDataJSON()).toEqual({ token });
    expect(route.request().url()).not.toContain(token);
    await gate; return route.fulfill({ json: { ...org, role: 'MEMBER' } });
  });
  await page.route(base, route => route.fulfill({ json: { ...org, role: 'MEMBER' } }));
  await login(page, invitePath);
  await expect(page.getByRole('heading', { name: 'Hai ricevuto un invito' })).toBeVisible();
  expect(page.url()).not.toContain(token); expect(posts).toBe(0);
  await page.getByRole('button', { name: 'Accetta invito' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => posts).toBe(1); release();
  await expect(page.getByRole('heading', { name: org.name, exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('dialoga:pending-invitation'))).toBeNull();
  await expect(page.getByRole('button', { name: 'Membri e inviti' })).toHaveCount(0);
});

test('wrong or unverified account cannot show organization details', async ({ page }) => {
  await page.route(`${base}/invites/${inviteId}/accept`, route => route.fulfill({ status: 403, json: {} }));
  await login(page, invitePath);
  await page.getByRole('button', { name: 'Accetta invito' }).click();
  await expect(page.getByRole('alert')).toContainText('email verificata');
  await expect(page.getByRole('heading', { name: org.name, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Esci', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accedi', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('dialoga:pending-invitation'))).toBeNull();
});

test('expired invite clears the secret and offers dismissal', async ({ page }) => {
  await page.route(`${base}/invites/${inviteId}/accept`, route => route.fulfill({ status: 410, json: {} }));
  await login(page, invitePath);
  await page.getByRole('button', { name: 'Accetta invito' }).click();
  await expect(page.getByRole('alert')).toContainText('scaduto, revocato');
  await expect(page.getByRole('button', { name: 'Accetta invito' })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('dialoga:pending-invitation'))).toBeNull();
  await page.getByRole('button', { name: 'Chiudi invito' }).click();
  await expect(page.getByRole('heading', { name: 'Crea la tua organizzazione' })).toBeVisible();
});

test('server permission denial blocks team data despite stale owner UI', async ({ page }) => {
  await page.route(`${base}/members`, route => route.fulfill({ status: 403, json: {} }));
  await login(page); await page.getByRole('button', { name: 'Membri e inviti' }).click();
  await expect(page.getByRole('alert')).toContainText('permessi necessari');
  await expect(page.getByLabel('Email del destinatario')).toHaveCount(0);
  await expect(page.getByText(member.email, { exact: true })).toHaveCount(0);
});

test('a malformed new link never reuses a previously saved invitation', async ({ page }) => {
  await page.addInitScript(({ orgId, inviteId, token }) => {
    if (location.origin !== 'http://localhost:5173' || sessionStorage.getItem('test:seeded-invitation')) return;
    sessionStorage.setItem('test:seeded-invitation', 'true');
    sessionStorage.setItem('dialoga:pending-invitation', JSON.stringify({ organizationId: orgId, inviteId, token }));
  }, { orgId, inviteId, token });
  await page.goto(`/#organization=${orgId}&invite=${inviteId}&token=invalid`);
  await expect(page.getByRole('button', { name: 'Accedi', exact: true })).toBeVisible();
  expect(page.url()).not.toContain('token=');
  expect(await page.evaluate(() => sessionStorage.getItem('dialoga:pending-invitation'))).toBeNull();
  await expect(page.getByText('Hai ricevuto un invito. Accedi con l’email del destinatario per continuare.')).toHaveCount(0);
});
