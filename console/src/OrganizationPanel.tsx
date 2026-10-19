import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SessionExpired } from './auth';
import { ProjectsPanel } from './ProjectsPanel';
import { MembersPanel } from './MembersPanel';
import { captureWorkspaceRoute, workspaceRoute } from './workspace';
import { createOrganization, getOrganization, OrganizationError, readRememberedOrganization, rememberOrganization, suggestedSlug, type Organization } from './organizations';

// Preserve validated IDs across the fixed OIDC callback.
captureWorkspaceRoute();

type State = { kind: 'loading' } | { kind: 'form'; notice?: string } | { kind: 'ready'; organization: Organization } | { kind: 'error'; message: string };

export function OrganizationPanel({ userId, onExpired }: { userId: string; onExpired: () => void }) {
  const [organizationId, setOrganizationId] = useState<string | null>(() => readRememberedOrganization(userId));
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<{ message: string; slug?: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retry, setRetry] = useState(0);
  const inFlight = useRef(false);
  const submission = useRef<AbortController | null>(null);
  const expired = useRef(onExpired);
  expired.current = onExpired;

  useEffect(() => () => submission.current?.abort(), []);
  useEffect(() => {
    const onHash = () => {
      const id = workspaceRoute().organizationId;
      if (id) setOrganizationId(id);
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!organizationId) { setState({ kind: 'form' }); return; }
    const controller = new AbortController();
    setState({ kind: 'loading' });
    getOrganization(organizationId, controller.signal).then(organization => {
      if (controller.signal.aborted) return;
      try { sessionStorage.removeItem('dialoga:requested-organization'); } catch { /* Optional storage. */ }
      rememberOrganization(userId, organization.id);
      setState({ kind: 'ready', organization });
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpired) { expired.current(); return; }
      if (error instanceof OrganizationError && error.status === 404) {
        try { sessionStorage.removeItem('dialoga:requested-organization'); } catch { /* Optional storage. */ }
        rememberOrganization(userId, null);
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        setState({ kind: 'form', notice: 'L’organizzazione non è disponibile o non hai più accesso. Puoi crearne una nuova.' });
      } else setState({ kind: 'error', message: 'Non è stato possibile caricare l’organizzazione. Riprova tra poco.' });
    });
    return () => controller.abort();
  }, [organizationId, retry, userId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!name.trim() || name.trim().length > 160) { setError({ message: 'Inserisci un nome da 1 a 160 caratteri.' }); return; }
    if (slug.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setError({ message: 'Usa lettere minuscole, numeri e trattini singoli per l’indirizzo.', slug: true }); return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const controller = new AbortController();
    submission.current = controller;
    try {
      const organization = await createOrganization(name, slug, controller.signal);
      if (controller.signal.aborted) return;
      rememberOrganization(userId, organization.id);
      setState({ kind: 'ready', organization });
      window.location.hash = `organization=${organization.id}`;
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpired) expired.current();
      else setError({ message: error instanceof OrganizationError ? error.message : 'Connessione interrotta. La creazione non è confermata: verifica prima di inviare di nuovo.', slug: error instanceof OrganizationError && error.status === 409 });
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  if (state.kind === 'loading') return <div className="organization-panel" role="status">Caricamento dell’organizzazione…</div>;
  if (state.kind === 'error') return <section className="organization-panel"><p className="notice" role="alert">{state.message}</p><button className="secondary" onClick={() => setRetry(n => n + 1)}>Ricarica organizzazione</button></section>;
  if (state.kind === 'ready') return <section className="organization-panel" aria-labelledby="organization-title">
    <p className="eyebrow">IL TUO SPAZIO È PRONTO</p>
    <h3 id="organization-title">{state.organization.name}</h3>
    <dl className="organization-details"><dt>Indirizzo</dt><dd>{state.organization.slug}</dd><dt>Il tuo ruolo</dt><dd><span className="status-pill">{state.organization.role}</span></dd></dl>
    <ProjectsPanel key={state.organization.id} organization={state.organization} onExpired={onExpired} />
    <MembersPanel key={state.organization.id + ":team"} organization={state.organization} onExpired={onExpired} />
    <a className="organization-link" href={`#organization=${state.organization.id}`}>Apri questa organizzazione <span aria-hidden="true">→</span></a>
  </section>;
  return <section className="organization-panel" aria-labelledby="organization-title">
    <p className="eyebrow">IL PRIMO PASSO</p><h3 id="organization-title">Crea la tua organizzazione</h3>
    <p>Uno spazio per il tuo team. Ne sarai il proprietario.</p>
    {state.notice && <p className="notice" role="status">{state.notice}</p>}
    <form onSubmit={submit} aria-busy={submitting}>
      <label htmlFor="organization-name">Nome dell’organizzazione</label>
      <input id="organization-name" name="organizationName" value={name} required maxLength={160} disabled={submitting} autoComplete="organization" placeholder="Es. Studio Aurora" onChange={event => { setName(event.target.value); if (!slugEdited) setSlug(suggestedSlug(event.target.value)); setError(null); }} />
      <label htmlFor="organization-slug">Indirizzo dell’organizzazione</label>
      <input id="organization-slug" name="organizationSlug" value={slug} required maxLength={63} disabled={submitting} autoCapitalize="none" spellCheck={false} aria-invalid={!!error?.slug} aria-describedby={error ? 'slug-help organization-error' : 'slug-help'} placeholder="studio-aurora" onChange={event => { setSlugEdited(true); setSlug(event.target.value); setError(null); }} />
      <p id="slug-help" className="field-help">Minuscole, numeri e trattini. L’indirizzo deve essere unico.</p>
      {error && <p id="organization-error" className="notice" role="alert">{error.message}</p>}
      <button type="submit" className="primary" disabled={submitting}>{submitting ? 'Creazione in corso…' : 'Crea organizzazione'}</button>
    </form>
  </section>;
}
