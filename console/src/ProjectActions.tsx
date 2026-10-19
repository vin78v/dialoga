import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SessionExpired } from './auth';
import { archiveProject, updateProject, ProjectError, type Project } from './projects';

/** I controlli locali evitano errori; il backend verifica sempre i permessi correnti. */
export function ProjectActions({ project, onUpdated, onArchived, onUnavailable, onExpired }: {
  project: Project; onUpdated: (project: Project) => void; onArchived: () => void;
  onUnavailable: (message: string) => void; onExpired: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const request = useRef<AbortController | null>(null);
  // Navigazione e logout non devono ricevere aggiornamenti da risposte tardive.
  // L'abort non annulla un eventuale commit già completato dal server.
  useEffect(() => () => request.current?.abort(), []);

  async function mutate(archive: boolean) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    const controller = new AbortController(); request.current = controller;
    try {
      if (archive) {
        await archiveProject(project.organizationId, project.id, controller.signal);
        if (!controller.signal.aborted) onArchived();
      } else {
        const updated = await updateProject(project.organizationId, project.id, name, description, controller.signal);
        if (!controller.signal.aborted) { onUpdated(updated); setEditing(false); setNotice('Progetto aggiornato.'); }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpired) onExpired();
      else if (error instanceof ProjectError && [403, 404].includes(error.status)) {
        // Una schermata con permessi obsoleti non deve continuare a proporre
        // modifiche o mostrare il team dopo il rifiuto esplicito del server.
        onUnavailable(error.message);
      } else setError(error instanceof ProjectError ? error.message : 'Connessione interrotta. Ricarica il progetto per verificare se l’operazione è riuscita.');
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || name.trim().length > 160) { setError('Inserisci un nome da 1 a 160 caratteri.'); return; }
    if (description.length > 2000) { setError('La descrizione può avere al massimo 2000 caratteri.'); return; }
    void mutate(false);
  }
  return <section className="project-actions" aria-label="Modifica e archiviazione progetto">
    {editing ? <form onSubmit={save} aria-busy={busy}>
      <h6>Modifica progetto</h6>
      <label htmlFor="edit-project-name">Nome del progetto</label><input id="edit-project-name" value={name} maxLength={160} required disabled={busy} onChange={event => setName(event.target.value)} />
      <label htmlFor="edit-project-description">Descrizione (facoltativa)</label><textarea id="edit-project-description" value={description} maxLength={2000} rows={3} disabled={busy} onChange={event => setDescription(event.target.value)} />
      <p className="field-help">L’indirizzo del progetto rimane invariato.</p>
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Salvataggio in corso…' : 'Salva modifiche'}</button>
      <button className="text-button" type="button" disabled={busy} onClick={() => { setEditing(false); setError(null); }}>Annulla modifica</button>
    </form> : !confirmArchive && <button className="secondary" disabled={busy} onClick={() => { setName(project.name); setDescription(project.description || ''); setEditing(true); setError(null); setNotice(null); }}>Modifica progetto</button>}
    {confirmArchive ? <div className="remove-access">
      <p>Archiviare <strong>{project.name}</strong>?</p>
      <p className="field-help">I dati saranno conservati, ma il progetto scomparirà dall’elenco e non sarà più accessibile ai membri. Potrai ripristinarlo dalla sezione Progetti archiviati.</p>
      <button className="secondary" disabled={busy} onClick={() => void mutate(true)}>{busy ? 'Archiviazione in corso…' : 'Conferma archiviazione'}</button>
      <button className="text-button" disabled={busy} onClick={() => { setConfirmArchive(false); setError(null); }}>Annulla archiviazione</button>
    </div> : !editing && <button className="text-button" disabled={busy} onClick={() => { setConfirmArchive(true); setError(null); setNotice(null); }}>Archivia progetto</button>}
    {error && <p className="notice" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
