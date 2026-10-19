import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SessionExpired } from './auth';
import { suggestedSlug, type Organization } from './organizations';
import { createProject, getProject, listProjects, ProjectError, type Project } from './projects';
import { clearRequestedProject, requestedProject, workspaceHash, workspaceRoute } from './workspace';

export function ProjectsPanel({ organization, onExpired }: { organization: Organization; onExpired: () => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listAttempt, setListAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(() => requestedProject(organization.id));
  const [detail, setDetail] = useState<Project | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [formError, setFormError] = useState<{ message: string; slug?: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const submission = useRef<AbortController | null>(null);
  const expired = useRef(onExpired);
  expired.current = onExpired;
  const canCreate = organization.role === 'OWNER' || organization.role === 'ADMIN';

  useEffect(() => () => submission.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    setProjects(null); setListError(null);
    listProjects(organization.id, controller.signal).then(result => {
      if (!controller.signal.aborted) setProjects(result);
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpired) expired.current();
      else setListError(error instanceof ProjectError && error.status === 404 ? 'L’organizzazione non è più disponibile o non hai accesso.' : 'Non è stato possibile caricare i progetti. Riprova tra poco.');
    });
    return () => controller.abort();
  }, [organization.id, listAttempt]);

  useEffect(() => {
    const changed = () => {
      const route = workspaceRoute();
      if (route.organizationId === organization.id) {
        setSelectedId(route.projectId);
        setCreating(false);
      }
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [organization.id]);

  useEffect(() => {
    setDetail(null); setDetailError(null);
    if (!selectedId) return;
    const controller = new AbortController();
    getProject(organization.id, selectedId, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      clearRequestedProject();
      setDetail(result);
      window.history.replaceState(null, '', workspaceHash(organization.id, result.id));
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpired) expired.current();
      else {
        if (error instanceof ProjectError && error.status === 404) clearRequestedProject();
        setDetailError(error instanceof ProjectError ? error.message : 'Non è stato possibile caricare il progetto. Riprova tra poco.');
      }
    });
    return () => controller.abort();
  }, [organization.id, selectedId, detailAttempt]);

  function open(id: string) {
    setCreating(false); setSelectedId(id);
    window.location.hash = workspaceHash(organization.id, id);
  }
  function back() {
    clearRequestedProject(); setSelectedId(null); setCreating(false);
    window.location.hash = workspaceHash(organization.id);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!name.trim() || name.trim().length > 160) { setFormError({ message: 'Inserisci un nome da 1 a 160 caratteri.' }); return; }
    if (slug.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) { setFormError({ message: 'Usa lettere minuscole, numeri e trattini singoli.', slug: true }); return; }
    if (description.length > 2000) { setFormError({ message: 'La descrizione può avere al massimo 2000 caratteri.' }); return; }
    inFlight.current = true; setSubmitting(true); setFormError(null);
    const controller = new AbortController(); submission.current = controller;
    try {
      const project = await createProject(organization.id, name, slug, description, controller.signal);
      if (controller.signal.aborted) return;
      setProjects(previous => [project, ...(previous || [])]);
      setName(''); setSlug(''); setDescription(''); setSlugEdited(false);
      open(project.id);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpired) expired.current();
      else setFormError({ message: error instanceof ProjectError ? error.message : 'Connessione interrotta. Aggiorna l’elenco prima di riprovare: la creazione non è confermata.', slug: error instanceof ProjectError && error.status === 409 });
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  return <section className="projects-panel" aria-labelledby="projects-title">
    <div className="projects-heading"><h4 id="projects-title">Progetti</h4>{!selectedId && !creating && canCreate && projects && <button className="compact-button" onClick={() => { setCreating(true); setFormError(null); }}>Nuovo progetto</button>}</div>
    {selectedId ? <>
      <button className="text-button" onClick={back}>← Torna ai progetti</button>
      {detailError ? <><p className="notice" role="alert">{detailError}</p><button className="secondary" onClick={() => setDetailAttempt(n => n + 1)}>Ricarica progetto</button></> : detail ? <article className="project-detail" aria-labelledby="project-name">
        <span className="status-pill">Attivo</span><h5 id="project-name">{detail.name}</h5>
        <dl><dt>Indirizzo del progetto</dt><dd>{detail.slug}</dd><dt>Descrizione</dt><dd className="project-description">{detail.description || 'Nessuna descrizione.'}</dd></dl>
      </article> : <p role="status">Caricamento del progetto…</p>}
    </> : listError ? <><p className="notice" role="alert">{listError}</p><button className="secondary" onClick={() => setListAttempt(n => n + 1)}>Ricarica progetti</button></> : projects === null ? <p role="status">Caricamento dei progetti…</p> : <>
      {creating ? <form onSubmit={submit} aria-busy={submitting} className="project-form">
        <h5>Crea un progetto</h5>
        <label htmlFor="project-name-input">Nome del progetto</label><input id="project-name-input" value={name} required maxLength={160} disabled={submitting} onChange={e => { setName(e.target.value); if (!slugEdited) setSlug(suggestedSlug(e.target.value)); setFormError(null); }} placeholder="Es. Assistenza clienti" />
        <label htmlFor="project-slug">Indirizzo del progetto</label><input id="project-slug" value={slug} required maxLength={63} disabled={submitting} autoCapitalize="none" spellCheck={false} aria-invalid={!!formError?.slug} aria-describedby={formError ? 'project-slug-help project-error' : 'project-slug-help'} onChange={e => { setSlugEdited(true); setSlug(e.target.value); setFormError(null); }} placeholder="assistenza-clienti" />
        <p id="project-slug-help" className="field-help">Minuscole, numeri e trattini. Unico in questa organizzazione.</p>
        <label htmlFor="project-description">Descrizione (facoltativa)</label><textarea id="project-description" value={description} maxLength={2000} disabled={submitting} rows={3} onChange={e => setDescription(e.target.value)} />
        {formError && <p id="project-error" className="notice" role="alert">{formError.message}</p>}
        <button className="primary" type="submit" disabled={submitting}>{submitting ? 'Creazione progetto in corso…' : 'Crea progetto'}</button>
        <button className="secondary" type="button" disabled={submitting} onClick={() => setCreating(false)}>Annulla</button>
      </form> : projects.length === 0 ? <p className="empty-projects">{canCreate ? 'Nessun progetto per ora. Crea il primo spazio per le tue conversazioni.' : 'Non hai ancora progetti assegnati.'}</p> : <ul className="project-list">{projects.map(project => <li key={project.id}><button onClick={() => open(project.id)}><strong>{project.name}</strong><span>{project.slug}</span><span aria-hidden="true">→</span></button></li>)}</ul>}
      <button className="text-button" disabled={submitting} onClick={() => { setCreating(false); setListAttempt(n => n + 1); }}>Aggiorna elenco</button>
    </>}
  </section>;
}
