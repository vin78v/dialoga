import { authenticatedFetch } from './auth';

export type Project = { id: string; organizationId: string; name: string; slug: string; description: string | null; status: 'ACTIVE' };
export class ProjectError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const path = (organizationId: string) => `/api/organizations/${encodeURIComponent(organizationId)}/projects`;
export async function listProjects(organizationId: string, signal: AbortSignal): Promise<Project[]> {
  const response = await authenticatedFetch(path(organizationId), { signal });
  if (!response.ok) throw new ProjectError(response.status, 'Non è stato possibile caricare i progetti.');
  return response.json();
}
export async function getProject(organizationId: string, projectId: string, signal: AbortSignal): Promise<Project> {
  const response = await authenticatedFetch(`${path(organizationId)}/${encodeURIComponent(projectId)}`, { signal });
  if (!response.ok) throw new ProjectError(response.status, response.status === 404 ? 'Progetto non disponibile o non accessibile.' : 'Non è stato possibile caricare il progetto.');
  return response.json();
}
export async function createProject(organizationId: string, name: string, slug: string, description: string, signal: AbortSignal): Promise<Project> {
  const response = await authenticatedFetch(path(organizationId), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim(), slug, description: description.trim() || null }), signal,
  });
  if (!response.ok) {
    const messages: Record<number, string> = {
      400: 'Controlla nome, indirizzo e descrizione del progetto.',
      403: 'Solo il proprietario o un amministratore può creare progetti.',
      404: 'L’organizzazione non è più disponibile o non hai accesso.',
      409: 'Questo indirizzo è già usato da un progetto dell’organizzazione.',
    };
    throw new ProjectError(response.status, messages[response.status] || 'Creazione non confermata. Aggiorna l’elenco prima di inviare di nuovo: il progetto potrebbe essere stato creato.');
  }
  return response.json();
}

// PUT modifica solo i metadati; l'archiviazione è un'azione esplicita separata.
export async function updateProject(organizationId: string, projectId: string, name: string, description: string, signal: AbortSignal): Promise<Project> {
  const response = await authenticatedFetch(`${path(organizationId)}/${encodeURIComponent(projectId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim(), description: description.trim() || null }), signal,
  });
  if (!response.ok) throw mutationError(response.status);
  return response.json();
}
export async function archiveProject(organizationId: string, projectId: string, signal: AbortSignal): Promise<void> {
  const response = await authenticatedFetch(`${path(organizationId)}/${encodeURIComponent(projectId)}/archive`, { method: 'POST', signal });
  if (!response.ok) throw mutationError(response.status);
}
function mutationError(status: number): ProjectError {
  const messages: Record<number, string> = {
    400: 'Controlla nome e descrizione del progetto.',
    403: 'Solo il proprietario o un amministratore può modificare o archiviare progetti.',
    404: 'Progetto non disponibile, archiviato o non accessibile.',
  };
  return new ProjectError(status, messages[status] || 'Operazione non confermata. Ricarica il progetto per verificarne lo stato prima di riprovare.');
}
