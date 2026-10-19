import { useEffect, useRef, useState } from 'react';
import { SessionExpired } from './auth';
import { listArchivedProjects, restoreProject, ProjectError, type ArchivedProject, type Project } from './projects';

/** Gli archivi espongono soltanto metadati: nessuna modifica o gestione del team. */
export function ArchivedProjectsPanel({ organizationId, revision, onRestored, onExpired }: {
  organizationId: string; revision: number; onRestored: (project: Project) => void; onExpired: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [projects, setProjects] = useState<ArchivedProject[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  const expired = useRef(onExpired); expired.current = onExpired;
  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setProjects(null); setLoadError(null); setError(null); setSelected(null);
    listArchivedProjects(organizationId, controller.signal).then(result => {
      if (!controller.signal.aborted) setProjects(result);
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpired) expired.current();
      else setLoadError(error instanceof ProjectError ? error.message : 'Non è stato possibile caricare i progetti archiviati.');
    });
    // Cambio organizzazione, aggiornamento o chiusura invalidano risposte tardive.
    return () => controller.abort();
  }, [organizationId, expanded, attempt, revision]);

  async function restore(project: ArchivedProject) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    const controller = new AbortController(); mutation.current = controller;
    try {
      const active = await restoreProject(organizationId, project.id, controller.signal);
      if (!controller.signal.aborted) onRestored(active);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpired) expired.current();
      else if (error instanceof ProjectError && [403, 404].includes(error.status)) {
        // Il rifiuto corrente del server prevale sul ruolo mostrato in precedenza.
        setProjects(null); setSelected(null); setLoadError(error.message);
      } else setError(error instanceof ProjectError ? error.message : 'Connessione interrotta. Aggiorna gli archiviati per verificare se il ripristino è riuscito.');
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return <section className="archived-projects" aria-label="Gestione progetti archiviati">
    <button className="secondary" disabled={busy} aria-expanded={expanded} aria-controls="archived-projects-content" onClick={() => { setExpanded(value => !value); setSelected(null); setError(null); }}>Progetti archiviati</button>
    {expanded && <div id="archived-projects-content"><h5>Progetti archiviati</h5>
      {loadError ? <><p className="notice" role="alert">{loadError}</p><button className="secondary" onClick={() => setAttempt(n => n + 1)}>Ricarica archiviati</button></> : projects === null ? <p role="status">Caricamento degli archiviati…</p> : <>
        {projects.length === 0 ? <p>Nessun progetto archiviato.</p> : <ul className="archived-list" aria-label="Elenco progetti archiviati">{projects.map(project => <li key={project.id}>
          <span className="status-pill">Archiviato</span><h6>{project.name}</h6>
          <dl><dt>Indirizzo del progetto</dt><dd>{project.slug}</dd><dt>Descrizione</dt><dd className="project-description">{project.description || 'Nessuna descrizione.'}</dd></dl>
          {selected === project.id ? <div className="restore-confirmation"><p>Ripristinare <strong>{project.name}</strong>?</p>
            <p className="field-help">Il progetto tornerà attivo. I membri con assegnazione ancora attiva potranno accedervi. Gli accessi revocati non saranno ripristinati.</p>
            <button className="primary" disabled={busy} onClick={() => void restore(project)}>{busy ? 'Ripristino in corso…' : 'Conferma ripristino'}</button>
            <button className="text-button" disabled={busy} onClick={() => { setSelected(null); setError(null); }}>Annulla ripristino</button>
          </div> : <button className="text-button" disabled={busy} aria-label={`Ripristina progetto ${project.name}`} onClick={() => { setSelected(project.id); setError(null); }}>Ripristina progetto</button>}
        </li>)}</ul>}
        {error && <p className="notice" role="alert">{error}</p>}
        <button className="text-button" disabled={busy} onClick={() => setAttempt(n => n + 1)}>Aggiorna archiviati</button>
      </>}
    </div>}
  </section>;
}
