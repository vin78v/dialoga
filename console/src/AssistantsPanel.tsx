import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { SessionExpired } from './auth';
import {
  AssistantError, createAssistant, getAssistant, listAssistants, updateAssistant,
  type AssistantDetails, type AssistantDraft, type AssistantList, type AssistantStatus,
} from './assistants';

const blankDraft = (): AssistantDraft => ({ name: '', instructions: '', welcomeMessage: '' });
const statusLabel: Record<AssistantStatus, string> = { DRAFT: 'Bozza', PUBLISHED: 'Pubblicato', SUSPENDED: 'Sospeso' };
type View = 'list' | 'create' | 'detail' | 'edit';

/** I permessi restituiti dal server governano i controlli, senza dedurre ruoli dal token. */
export function AssistantsPanel({ organizationId, projectId, onExpired }: {
  organizationId: string; projectId: string; onExpired: () => void;
}) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const [list, setList] = useState<AssistantList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listAttempt, setListAttempt] = useState(0);
  const [view, setView] = useState<View>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AssistantDetails | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [draft, setDraft] = useState<AssistantDraft>(blankDraft);
  const [editTarget, setEditTarget] = useState<{ assistantId: string; expectedVersion: number } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const viewRef = useRef(view); viewRef.current = view;
  const inFlight = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  const expired = useRef(onExpired); expired.current = onExpired;

  // L'abort evita aggiornamenti nel progetto successivo; non annulla un commit
  // che il server potrebbe aver già completato durante la navigazione.
  useEffect(() => () => mutation.current?.abort(), [organizationId, projectId]);

  function unavailable(message: string) {
    setList(null); setListError(message); setDetail(null); setSelectedId(null);
    setDraft(blankDraft()); setEditTarget(null); setView('list'); setFormError(null); setConflict(false); setNotice(null);
  }

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setList(null); setListError(null);
    listAssistants(organizationId, projectId, controller.signal).then(result => {
      if (!controller.signal.aborted) setList(result);
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpired) expired.current();
      else if (error instanceof AssistantError && [403, 404].includes(error.status)) unavailable(error.message);
      else setListError(error instanceof AssistantError ? error.message : 'Non è stato possibile caricare gli assistenti.');
    });
    return () => controller.abort();
  }, [organizationId, projectId, expanded, listAttempt]);

  useEffect(() => {
    if (!selectedId || !expanded) return;
    const controller = new AbortController();
    setDetail(null); setDetailError(null);
    getAssistant(organizationId, projectId, selectedId, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setDetail(result);
      if (viewRef.current === 'edit' && (!result.canEdit || result.status !== 'DRAFT')) {
        // Anche una lettura può scoprire una revoca o un cambio di stato:
        // conserviamo il testo locale, rendendo esplicito il motivo del blocco.
        setConflict(true);
        setFormError('La bozza non è più modificabile. Il testo inserito è conservato: ricarica e scarta le modifiche per continuare.');
      }
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpired) expired.current();
      else if (error instanceof AssistantError && [403, 404].includes(error.status)) unavailable(error.message);
      else setDetailError(error instanceof AssistantError ? error.message : 'Non è stato possibile caricare l’assistente.');
    });
    return () => controller.abort();
  }, [organizationId, projectId, selectedId, expanded, detailAttempt]);

  function back() {
    setSelectedId(null); setDetail(null); setDetailError(null); setDraft(blankDraft()); setEditTarget(null);
    setView('list'); setFormError(null); setConflict(false); setNotice(null);
  }

  function open(id: string) {
    setDetail(null); setDetailError(null); setSelectedId(id); setDetailAttempt(value => value + 1);
    setView('detail'); setFormError(null); setNotice(null);
  }

  function startCreate() {
    setSelectedId(null); setDetail(null); setDraft(blankDraft()); setEditTarget(null); setFormError(null);
    setConflict(false); setNotice(null); setView('create');
  }

  function startEdit() {
    if (!detail?.canEdit || detail.status !== 'DRAFT') return;
    setDraft({ name: detail.name, instructions: detail.instructions, welcomeMessage: detail.welcomeMessage || '' });
    // La versione appartiene al testo inizialmente aperto: una successiva lettura
    // del dettaglio non può autorizzare a sovrascrivere modifiche di altre persone.
    setEditTarget({ assistantId: detail.id, expectedVersion: detail.draftLockVersion });
    setFormError(null); setConflict(false); setNotice(null); setView('edit');
  }

  function refreshList() {
    back(); setListAttempt(value => value + 1);
  }

  function discardAndReload() {
    const assistantId = editTarget?.assistantId || detail?.id;
    if (!assistantId) return;
    // Un conflitto non cambia la versione in silenzio: solo questa azione
    // esplicita scarta il testo locale e rilegge la bozza corrente.
    setDraft(blankDraft()); setEditTarget(null); setFormError(null); setConflict(false); open(assistantId);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || conflict || (view !== 'create' && view !== 'edit')) return;
    if (!draft.name.trim() || draft.name.trim().length > 160) { setFormError('Inserisci un nome da 1 a 160 caratteri.'); return; }
    if (!draft.instructions.trim() || draft.instructions.trim().length > 12000) { setFormError('Inserisci istruzioni da 1 a 12000 caratteri.'); return; }
    if (draft.welcomeMessage.length > 1000) { setFormError('Il messaggio iniziale può avere al massimo 1000 caratteri.'); return; }
    const creating = view === 'create';
    if ((!creating && (!editTarget || !detail?.canEdit || detail.id !== editTarget.assistantId || detail.status !== 'DRAFT')) || (creating && !list?.canEdit)) return;
    inFlight.current = true; setBusy(true); setFormError(null); setNotice(null);
    const controller = new AbortController(); mutation.current = controller;
    try {
      const result = creating
        ? await createAssistant(organizationId, projectId, draft, controller.signal)
        : await updateAssistant(organizationId, projectId, editTarget!.assistantId, draft, editTarget!.expectedVersion, controller.signal);
      if (controller.signal.aborted) return;
      setDetail(result); setDraft(blankDraft()); setEditTarget(null); setView('detail');
      setNotice(creating ? 'Assistente creato come bozza.' : 'Bozza salvata.');
      // Il dettaglio restituito è già aggiornato; la lista viene invalidata
      // per non riutilizzare nomi o capability letti prima del salvataggio.
      setListAttempt(value => value + 1);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpired) expired.current();
      else if (error instanceof AssistantError && [403, 404].includes(error.status)) unavailable(error.message);
      else {
        if (!creating && error instanceof AssistantError && error.status === 409) setConflict(true);
        setFormError(error instanceof AssistantError ? error.message : creating
          ? 'Creazione non confermata. Aggiorna gli assistenti prima di inviare di nuovo: la bozza potrebbe essere stata creata.'
          : 'Salvataggio non confermato. Ricarica l’assistente per verificarne lo stato prima di riprovare.');
      }
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const editing = view === 'edit';
  const form = view === 'create' || editing;
  return <section className="assistants-panel" aria-label="Assistenti del progetto">
    <button className="secondary" disabled={busy} aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)}>Assistenti</button>
    {expanded && <div id={contentId}>
      <h6>Assistenti del progetto</h6>
      <p className="field-help">Crea la configurazione di un assistente e prepara le sue istruzioni.</p>
      {notice && <p role="status">{notice}</p>}
      {listError ? <>
        <p className="notice" role="alert">{listError}</p>
        <button className="secondary" disabled={busy} onClick={() => setListAttempt(value => value + 1)}>Ricarica assistenti</button>
      </> : form ? <form className="assistant-form" onSubmit={save} aria-busy={busy}>
        <h6>{editing ? 'Modifica bozza' : 'Nuovo assistente'}</h6>
        <p className="field-help">La bozza non è pubblicata e non risponde ancora in chat.</p>
        <label htmlFor={`${contentId}-name`}>Nome dell’assistente</label>
        <input id={`${contentId}-name`} value={draft.name} required maxLength={160} disabled={busy} onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} />
        <label htmlFor={`${contentId}-instructions`}>Istruzioni dell’assistente</label>
        <textarea id={`${contentId}-instructions`} value={draft.instructions} required maxLength={12000} rows={8} disabled={busy} onChange={event => setDraft(value => ({ ...value, instructions: event.target.value }))} />
        <p className="field-help">Descrivi lo scopo, il tono e le regole da seguire. Massimo 12000 caratteri.</p>
        <label htmlFor={`${contentId}-welcome`}>Messaggio iniziale (facoltativo)</label>
        <textarea id={`${contentId}-welcome`} value={draft.welcomeMessage} maxLength={1000} rows={3} disabled={busy} onChange={event => setDraft(value => ({ ...value, welcomeMessage: event.target.value }))} />
        {formError && <p className="notice" role="alert">{formError}</p>}
        {editing && detailError && <><p className="notice" role="alert">{detailError}</p><button className="secondary" type="button" disabled={busy} onClick={() => setDetailAttempt(value => value + 1)}>Ricarica assistente</button></>}
        {conflict && <button className="secondary" type="button" disabled={busy} onClick={discardAndReload}>Ricarica e scarta modifiche</button>}
        <div className="assistant-actions">
          <button className="primary" type="submit" disabled={busy || conflict || (editing ? !detail?.canEdit || detail.status !== 'DRAFT' : !list?.canEdit)}>{busy ? 'Salvataggio in corso…' : editing ? 'Salva bozza' : 'Crea assistente'}</button>
          <button className="text-button" type="button" disabled={busy} onClick={() => { setDraft(blankDraft()); setEditTarget(null); setFormError(null); setConflict(false); setView(editing ? 'detail' : 'list'); }}>{editing ? 'Annulla modifica' : 'Annulla creazione'}</button>
        </div>
      </form> : view === 'detail' ? <>
        <button className="text-button" disabled={busy} onClick={back}>Torna agli assistenti</button>
        {detailError ? <><p className="notice" role="alert">{detailError}</p><button className="secondary" onClick={() => setDetailAttempt(value => value + 1)}>Ricarica assistente</button></> : !detail ? <p role="status">Caricamento dell’assistente…</p> : <article className="assistant-detail" aria-labelledby={`${contentId}-title`}>
          <span className="status-pill">{statusLabel[detail.status]}</span>
          <h6 id={`${contentId}-title`}>{detail.name}</h6>
          {detail.status === 'DRAFT' && <p className="field-help">La bozza non è pubblicata e non risponde ancora in chat.</p>}
          <dl>
            <dt>Istruzioni dell’assistente</dt><dd className="assistant-instructions">{detail.instructions}</dd>
            <dt>Messaggio iniziale</dt><dd className="assistant-instructions">{detail.welcomeMessage || 'Nessun messaggio iniziale.'}</dd>
          </dl>
          {detail.canEdit && detail.status === 'DRAFT' && <button className="secondary" disabled={busy} onClick={startEdit}>Modifica bozza</button>}
        </article>}
      </> : list === null ? <p role="status">Caricamento degli assistenti…</p> : <>
        {list.canEdit && <button className="secondary" onClick={startCreate}>Nuovo assistente</button>}
        {list.items.length === 0 ? <p>Nessun assistente in questo progetto.</p> : <ul className="project-list assistants-list" aria-label="Elenco assistenti">{list.items.map(assistant => <li key={assistant.id}>
          <button onClick={() => open(assistant.id)} aria-label={`Apri assistente ${assistant.name}`}>
            <strong>{assistant.name}</strong><span>{statusLabel[assistant.status]}</span><span aria-hidden="true">→</span>
          </button>
        </li>)}</ul>}
      </>}
      {!listError && <button className="text-button" type="button" disabled={busy || conflict} onClick={refreshList}>Aggiorna assistenti</button>}
    </div>}
  </section>;
}
