import { authenticatedFetch } from './auth';

export type ProjectRole = 'MANAGER' | 'EDITOR' | 'OPERATOR' | 'VIEWER';
export type ProjectMembership = {
  id: string; userId: string; email: string; role: ProjectRole; status: 'ACTIVE' | 'SUSPENDED';
  organizationRole: string; organizationMembershipStatus: string; userStatus: string;
};
export class MembershipError extends Error { constructor(public status: number, message: string) { super(message); } }
const base = (org: string, project: string) => `/api/organizations/${encodeURIComponent(org)}/projects/${encodeURIComponent(project)}/members`;
async function checked(path: string, options: RequestInit) {
  const response = await authenticatedFetch(path, options);
  if (!response.ok) {
    const messages: Record<number, string> = {
      400: 'Seleziona un ruolo di progetto valido.',
      403: 'Solo OWNER e ADMIN possono gestire gli accessi ai progetti.',
      404: 'Il progetto o il membro non è disponibile in questa organizzazione.',
      409: 'Serve un membro attivo. OWNER e ADMIN hanno già accesso a tutti i progetti.',
    };
    throw new MembershipError(response.status, messages[response.status] || 'Operazione non confermata. Ricarica gli accessi per verificarne lo stato.');
  }
  return response;
}
export async function listProjectMemberships(org: string, project: string, signal: AbortSignal): Promise<ProjectMembership[]> {
  return (await checked(base(org, project), { signal })).json();
}
// PUT e DELETE sono idempotenti: un retry non crea una seconda membership.
// Non eseguiamo comunque retry automatici, per lasciare visibile l'esito all'utente.
export async function assignProjectMember(org: string, project: string, user: string, role: ProjectRole, signal: AbortSignal): Promise<ProjectMembership> {
  return (await checked(base(org, project) + '/' + encodeURIComponent(user), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }), signal,
  })).json();
}
export async function removeProjectMember(org: string, project: string, user: string, signal: AbortSignal) {
  await checked(base(org, project) + '/' + encodeURIComponent(user), { method: 'DELETE', signal });
}
