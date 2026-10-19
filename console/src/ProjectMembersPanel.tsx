import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SessionExpired } from './auth';
import type { Organization } from './organizations';
import { listMembers, type Member } from './team';
import { assignProjectMember, listProjectMemberships, MembershipError, removeProjectMember, type ProjectMembership, type ProjectRole } from './projectMemberships';

const roles: { value: ProjectRole; label: string }[] = [
  { value: 'VIEWER', label: 'VIEWER · Consultazione' },
  { value: 'OPERATOR', label: 'OPERATOR · Conversazioni' },
  { value: 'EDITOR', label: 'EDITOR · Configurazione' },
  { value: 'MANAGER', label: 'MANAGER · Gestione del progetto' },
];
/** La UI facilita la scelta; tutte le autorizzazioni sono ripetute dal backend. */
export function ProjectMembersPanel({ organization, projectId, onExpired }: { organization: Organization; projectId: string; onExpired: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [memberships, setMemberships] = useState<ProjectMembership[] | null>(null);
  const [candidates, setCandidates] = useState<Member[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<ProjectRole>('VIEWER');
  const [confirmRemoval, setConfirmRemoval] = useState<ProjectMembership | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  const expired = useRef(onExpired); expired.current = onExpired;
  const canManage = organization.role === 'OWNER' || organization.role === 'ADMIN';

  // Cambiando progetto o uscendo dalla pagina, una risposta tardiva non deve
  // aggiornare il nuovo contesto. Il server potrebbe avere già completato il commit.
  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    if (!expanded || !canManage) return;
    const controller = new AbortController(); setMemberships(null); setLoadError(null);
    Promise.all([listProjectMemberships(organization.id, projectId, controller.signal), listMembers(organization.id, controller.signal)])
      .then(([memberships, members]) => {
        if (controller.signal.aborted) return;
        setMemberships(memberships);
        // Gli amministratori hanno accesso implicito: non vanno proposti come
        // destinatari di assegnazioni che non potrebbero limitarne i permessi.
        setCandidates(members.filter(member => member.role === 'MEMBER' && member.status === 'ACTIVE' && member.userStatus === 'ACTIVE'));
      }).catch(error => {
        if (controller.signal.aborted) return;
        if (error instanceof SessionExpired) expired.current();
        else setLoadError(error instanceof Error ? error.message : 'Non è stato possibile caricare gli accessi.');
      });
    return () => controller.abort();
  }, [organization.id, projectId, expanded, canManage, attempt]);

  function chooseUser(id: string) {
    setUserId(id);
    // Precaricare il ruolo esistente evita un downgrade involontario al default.
    setRole(memberships?.find(member => member.userId === id)?.role || 'VIEWER');
    setError(null); setNotice(null); setConfirmRemoval(null);
  }
  function failed(error: unknown) {
    if (error instanceof SessionExpired) { expired.current(); return; }
    const message = error instanceof Error ? error.message : 'Operazione non confermata. Ricarica gli accessi.';
    if (error instanceof MembershipError && [403, 404].includes(error.status)) {
      // Un ruolo mostrato prima della revoca non giustifica mantenere dati del team
      // in una schermata che il server ha appena dichiarato non più accessibile.
      setMemberships(null); setCandidates([]); setLoadError(message);
    } else setError(message);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (inFlight.current || !userId) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    const controller = new AbortController(); mutation.current = controller;
    try {
      const member = await assignProjectMember(organization.id, projectId, userId, role, controller.signal);
      if (controller.signal.aborted) return;
      setMemberships(previous => [...(previous || []).filter(item => item.userId !== member.userId), member]);
      setNotice('Accesso salvato.'); setConfirmRemoval(null);
    } catch (error) { if (!controller.signal.aborted) failed(error); }
    finally { inFlight.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  async function remove() {
    if (!confirmRemoval || inFlight.current) return;
    const member = confirmRemoval;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    const controller = new AbortController(); mutation.current = controller;
    try {
      await removeProjectMember(organization.id, projectId, member.userId, controller.signal);
      if (controller.signal.aborted) return;
      setMemberships(previous => previous?.map(item => item.userId === member.userId ? { ...item, status: 'SUSPENDED' } : item) || []);
      if (userId === member.userId) { setUserId(''); setRole('VIEWER'); }
      setConfirmRemoval(null); setNotice('Accesso rimosso da questo progetto.');
    } catch (error) { if (!controller.signal.aborted) failed(error); }
    finally { inFlight.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  if (!canManage) return null;
  const selected = memberships?.find(member => member.userId === userId);
  return <section className="project-members-panel" aria-label="Gestione accessi al progetto">
    <button className="secondary" disabled={busy} onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls="project-access-content">Gestisci accessi</button>
    {expanded && <div id="project-access-content"><h6>Accessi al progetto</h6><p className="field-help">OWNER e ADMIN hanno già accesso a tutti i progetti.</p>
      {loadError ? <><p className="notice" role="alert">{loadError}</p><button className="secondary" onClick={() => setAttempt(n => n + 1)}>Ricarica accessi</button></> : memberships === null ? <p role="status">Caricamento degli accessi…</p> : <>
        {memberships.length === 0 ? <p>Nessun membro assegnato a questo progetto.</p> : <ul className="team-list" aria-label="Assegnazioni al progetto">{memberships.map(member => <li key={member.id}>
          <strong>{member.email}</strong><span>{member.role} · {member.status === 'ACTIVE' && member.organizationMembershipStatus === 'ACTIVE' && member.userStatus === 'ACTIVE' ? 'Attivo' : 'Non attivo'}</span>
          {member.organizationRole !== 'MEMBER' ? <span>Accesso implicito come amministratore.</span> : <div className="assignment-actions">
            {candidates.some(candidate => candidate.userId === member.userId) && <button className="text-button" disabled={busy} onClick={() => chooseUser(member.userId)} aria-label={`Modifica ruolo per ${member.email}`}>Modifica ruolo</button>}
            {member.status === 'ACTIVE' && <button className="text-button" disabled={busy} onClick={() => { setConfirmRemoval(member); setError(null); setNotice(null); }} aria-label={`Rimuovi accesso per ${member.email}`}>Rimuovi accesso</button>}
          </div>}
        </li>)}</ul>}
        {confirmRemoval && <div className="remove-access"><p>Rimuovere l’accesso di <strong>{confirmRemoval.email}</strong>?</p><p className="field-help">Saranno rimossi anche i permessi aggiuntivi di questo progetto.</p><button className="secondary" disabled={busy} onClick={remove}>Conferma rimozione</button><button className="text-button" disabled={busy} onClick={() => setConfirmRemoval(null)}>Annulla rimozione</button></div>}
        {candidates.length === 0 ? <p className="field-help">Non ci sono membri attivi da assegnare. Invita una persona nell’organizzazione.</p> : <form onSubmit={save} aria-busy={busy}>
          <label htmlFor="project-member-user">Membro dell’organizzazione</label><select id="project-member-user" value={userId} required disabled={busy} onChange={event => chooseUser(event.target.value)}><option value="">Seleziona un membro</option>{candidates.map(member => <option key={member.userId} value={member.userId}>{member.firstName ? `${member.firstName} ${member.lastName || ''} · ` : ''}{member.email}{candidates.filter(item => item.email === member.email).length > 1 ? ` · ID ${member.userId.slice(0, 8)}` : ''}</option>)}</select>
          <label htmlFor="project-member-role">Ruolo nel progetto</label><select id="project-member-role" value={role} disabled={busy} onChange={event => setRole(event.target.value as ProjectRole)}>{roles.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          {selected && (selected.role !== role || selected.status !== 'ACTIVE') && <p className="notice">Il cambio o ripristino dell’accesso rimuove i permessi aggiuntivi precedenti.</p>}
          <button className="primary" type="submit" disabled={busy || !userId}>{busy ? 'Salvataggio in corso…' : 'Salva accesso'}</button>
        </form>}
        {error && <p className="notice" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
        <button className="text-button" disabled={busy} onClick={() => { setConfirmRemoval(null); setNotice(null); setAttempt(n => n + 1); }}>Aggiorna accessi</button>
      </>}
    </div>}
  </section>;
}
