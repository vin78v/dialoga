import { authenticatedFetch } from './auth';

export type AssistantStatus = 'DRAFT' | 'PUBLISHED' | 'SUSPENDED';
export type AssistantSummary = {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  status: AssistantStatus;
  draftLockVersion: number;
};
export type AssistantList = { canEdit: boolean; items: AssistantSummary[] };
export type AssistantDetails = AssistantSummary & {
  instructions: string;
  welcomeMessage: string | null;
  canEdit: boolean;
};
export type AssistantDraft = { name: string; instructions: string; welcomeMessage: string };

export class AssistantError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const base = (organizationId: string, projectId: string) =>
  `/api/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/assistants`;

function error(status: number, operation: 'list' | 'detail' | 'create' | 'update') {
  const messages: Record<number, string> = {
    400: 'Controlla nome, istruzioni e messaggio iniziale dell’assistente.',
    403: 'Non hai più il permesso di gestire gli assistenti di questo progetto.',
    404: 'L’assistente o il progetto non è più disponibile o accessibile.',
    409: 'La bozza è stata modificata o non è più modificabile. Il testo inserito è conservato: ricarica e scarta le modifiche prima di riprovare.',
  };
  const fallback = operation === 'list' ? 'Non è stato possibile caricare gli assistenti.'
    : operation === 'detail' ? 'Non è stato possibile caricare l’assistente.'
    : operation === 'create' ? 'Creazione non confermata. Aggiorna gli assistenti prima di inviare di nuovo: la bozza potrebbe essere stata creata.'
    : 'Salvataggio non confermato. Ricarica l’assistente per verificarne lo stato prima di riprovare.';
  return new AssistantError(status, messages[status] || fallback);
}

export async function listAssistants(organizationId: string, projectId: string, signal: AbortSignal): Promise<AssistantList> {
  const response = await authenticatedFetch(base(organizationId, projectId), { signal, cache: 'no-store' });
  if (!response.ok) throw error(response.status, 'list');
  return response.json();
}

export async function getAssistant(organizationId: string, projectId: string, assistantId: string, signal: AbortSignal): Promise<AssistantDetails> {
  const response = await authenticatedFetch(`${base(organizationId, projectId)}/${encodeURIComponent(assistantId)}`, { signal, cache: 'no-store' });
  if (!response.ok) throw error(response.status, 'detail');
  return response.json();
}

// Il payload esplicito impedisce che stato, permessi o configurazioni estranee
// alla bozza vengano copiati accidentalmente da una risposta del server.
function draftPayload(draft: AssistantDraft) {
  return { name: draft.name.trim(), instructions: draft.instructions.trim(), welcomeMessage: draft.welcomeMessage.trim() || null };
}

export async function createAssistant(organizationId: string, projectId: string, draft: AssistantDraft, signal: AbortSignal): Promise<AssistantDetails> {
  const response = await authenticatedFetch(base(organizationId, projectId), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draftPayload(draft)), signal, cache: 'no-store',
  });
  // Una risposta persa può seguire un commit riuscito: nessun retry automatico.
  if (!response.ok) throw error(response.status, 'create');
  return response.json();
}

export async function updateAssistant(organizationId: string, projectId: string, assistantId: string, draft: AssistantDraft, expectedVersion: number, signal: AbortSignal): Promise<AssistantDetails> {
  const response = await authenticatedFetch(`${base(organizationId, projectId)}/${encodeURIComponent(assistantId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...draftPayload(draft), expectedVersion }), signal, cache: 'no-store',
  });
  if (!response.ok) throw error(response.status, 'update');
  return response.json();
}
