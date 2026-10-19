import { authenticatedFetch } from './auth';
import type { Organization } from './organizations';
export type Member = { id: string; userId: string; email: string; firstName: string | null; lastName: string | null; role: string; status: string; userStatus: string };
export type Invite = { id: string; organizationId: string; email: string; role: 'MEMBER' | 'ADMIN'; status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'; expiresAt: string; createdAt: string };
export type CreatedInvite = { invite: Invite; token: string };
export class TeamError extends Error { constructor(public status: number, message: string) { super(message); } }
const base = (org: string) => `/api/organizations/${encodeURIComponent(org)}`;
async function checked(path: string, options: RequestInit): Promise<Response> {
  const response = await authenticatedFetch(path, options);
  if (!response.ok) {
    const message: Record<number, string> = {
      400: 'Controlla l’indirizzo email e il ruolo selezionato.',
      403: 'Non hai i permessi necessari per questa operazione.',
      404: 'L’organizzazione o l’invito non è disponibile.',
      409: 'Esiste già un invito in attesa per questa email, oppure l’invito è già stato accettato.',
    };
    throw new TeamError(response.status, message[response.status] || 'Operazione non confermata. Ricarica i dati prima di riprovare.');
  }
  return response;
}
export async function listMembers(org: string, signal: AbortSignal): Promise<Member[]> {
  return (await checked(base(org) + '/members', { signal })).json();
}
export async function listInvites(org: string, signal: AbortSignal): Promise<Invite[]> {
  return (await checked(base(org) + '/invites', { signal })).json();
}
export async function createInvite(org: string, email: string, role: string, signal: AbortSignal): Promise<CreatedInvite> {
  return (await checked(base(org) + '/invites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), role }), signal })).json();
}
export async function revokeInvite(org: string, id: string, signal: AbortSignal) {
  await checked(base(org) + '/invites/' + encodeURIComponent(id), { method: 'DELETE', signal });
}
export async function acceptInvite(org: string, id: string, token: string, signal: AbortSignal): Promise<Organization> {
  const response = await authenticatedFetch(base(org) + '/invites/' + encodeURIComponent(id) + '/accept', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), signal,
  });
  if (!response.ok) {
    const messages: Record<number, string> = {
      403: 'Accedi con un account con email verificata corrispondente al destinatario dell’invito.',
      404: 'Il link d’invito non è valido o non è più disponibile.',
      410: 'L’invito è scaduto, revocato o non è più utilizzabile.',
      409: 'Hai già una membership in questa organizzazione. L’invito non può modificarla: contatta il proprietario.',
    };
    throw new TeamError(response.status, messages[response.status] || 'Accettazione non confermata. Puoi riprovare: lo stesso account non verrà aggiunto due volte.');
  }
  return response.json();
}
