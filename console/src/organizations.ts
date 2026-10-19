import { authenticatedFetch } from './auth';

export type Organization = { id: string; name: string; slug: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' };
export class OrganizationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function suggestedSlug(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63).replace(/-$/, '');
}
export async function getOrganization(id: string, signal: AbortSignal): Promise<Organization> {
  const response = await authenticatedFetch(`/api/organizations/${encodeURIComponent(id)}`, { signal });
  if (!response.ok) throw new OrganizationError(response.status, 'Non è stato possibile caricare l’organizzazione.');
  return response.json();
}
export async function createOrganization(name: string, slug: string, signal: AbortSignal): Promise<Organization> {
  const response = await authenticatedFetch('/api/organizations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), slug }), signal,
  });
  if (response.status === 409) throw new OrganizationError(409, 'Questo indirizzo è già occupato. Scegline un altro.');
  if (response.status === 400) throw new OrganizationError(400, 'Controlla il nome e l’indirizzo dell’organizzazione.');
  if (response.status === 403) throw new OrganizationError(403, 'Il tuo account non può creare un’organizzazione.');
  if (!response.ok) throw new OrganizationError(response.status, 'Creazione non confermata. Non inviare di nuovo senza verificare: l’organizzazione potrebbe essere stata creata.');
  return response.json();
}

// Only non-secret organization IDs are remembered. The API always rechecks access.
export function readRememberedOrganization(userId: string): string | null {
  try {
    const requested = sessionStorage.getItem('dialoga:requested-organization');
    const id = requested || localStorage.getItem(`dialoga:organization:${userId}`);
    return id && uuidPattern.test(id) ? id : null;
  } catch { return null; }
}
export function rememberOrganization(userId: string, id: string | null) {
  try {
    if (id) localStorage.setItem(`dialoga:organization:${userId}`, id);
    else localStorage.removeItem(`dialoga:organization:${userId}`);
  } catch { /* Storage is optional; API access must work without it. */ }
}
