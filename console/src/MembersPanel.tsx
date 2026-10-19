import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SessionExpired } from './auth';
import { invitationLink } from './invitation';
import type { Organization } from './organizations';
import { createInvite, listInvites, listMembers, revokeInvite, TeamError, type CreatedInvite, type Invite, type Member } from './team';

const stateLabel = { PENDING: 'In attesa', ACCEPTED: 'Accettato', REVOKED: 'Revocato', EXPIRED: 'Scaduto' };
export function MembersPanel({ organization, onExpired }: { organization: Organization; onExpired: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState<CreatedInvite | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  const expired = useRef(onExpired); expired.current = onExpired;
  const canManage = organization.role === 'OWNER' || organization.role === 'ADMIN';
  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    if (!expanded || !canManage) return;
    const controller = new AbortController(); setMembers(null); setLoadError(null);
    Promise.all([listMembers(organization.id, controller.signal), listInvites(organization.id, controller.signal)]).then(([members, invites]) => {
      if (!controller.signal.aborted) { setMembers(members); setInvites(invites); setGenerated(current => current && invites.some(invite => invite.id === current.invite.id && invite.status === 'PENDING') ? current : null); }
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpired) expired.current();
      else setLoadError(error instanceof TeamError ? error.message : 'Non è stato possibile caricare membri e inviti.');
    });
    return () => controller.abort();
  }, [organization.id, expanded, canManage, attempt]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setCopyStatus(null); setGenerated(null);
    const controller = new AbortController(); mutation.current = controller;
    try {
      const created = await createInvite(organization.id, email, role, controller.signal);
      if (controller.signal.aborted) return;
      setGenerated(created); setInvites(previous => [created.invite, ...previous]); setEmail('');
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpired) expired.current();
      else setError(error instanceof TeamError ? error.message : 'Creazione non confermata. Ricarica gli inviti prima di riprovare; il link potrebbe non essere recuperabile.');
    } finally { inFlight.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  async function revoke(invite: Invite) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    const controller = new AbortController(); mutation.current = controller;
    try {
      await revokeInvite(organization.id, invite.id, controller.signal);
      if (controller.signal.aborted) return;
      setInvites(previous => previous.map(item => item.id === invite.id ? { ...item, status: 'REVOKED' } : item));
      if (generated?.invite.id === invite.id) { setGenerated(null); setCopyStatus(null); }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof SessionExpired) expired.current();
      else setError(error instanceof TeamError ? error.message : 'Revoca non confermata. Ricarica gli inviti per verificarne lo stato.');
    } finally { inFlight.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  async function copy() {
    if (!generated) return;
    try { await navigator.clipboard.writeText(invitationLink(organization.id, generated.invite.id, generated.token)); setCopyStatus('Link copiato.'); }
    catch { setCopyStatus('Copia il link selezionandolo dal campo qui sopra.'); }
  }
  if (!canManage) return null;
  return <section className="members-panel" aria-label="Gestione del team">
    <button className="secondary" onClick={() => { setExpanded(value => !value); if (expanded) { setGenerated(null); setCopyStatus(null); } }} disabled={busy} aria-expanded={expanded} aria-controls="team-content">Membri e inviti</button>
    {expanded && <div id="team-content"><h4 id="team-title">Il team</h4>
      {loadError ? <><p className="notice" role="alert">{loadError}</p><button className="secondary" onClick={() => setAttempt(n => n + 1)}>Ricarica team</button></> : members === null ? <p role="status">Caricamento del team…</p> : <>
        <ul className="team-list" aria-label="Membri dell’organizzazione">{members.map(member => <li key={member.id}><strong>{member.email}</strong><span>{member.role} · {member.status === 'ACTIVE' && member.userStatus === 'ACTIVE' ? 'Attivo' : 'Non attivo'}</span></li>)}</ul>
        <form onSubmit={submit} aria-busy={busy}><h5>Invita una persona</h5>
          <label htmlFor="invite-email">Email del destinatario</label><input id="invite-email" type="email" required maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} autoCapitalize="none" autoComplete="email" />
          <label htmlFor="invite-role">Ruolo nell’organizzazione</label><select id="invite-role" value={role} disabled={busy} onChange={event => setRole(event.target.value)}><option value="MEMBER">MEMBER · Membro</option>{organization.role === 'OWNER' && <option value="ADMIN">ADMIN · Amministratore</option>}</select>
          <p className="field-help">Il link sarà valido sette giorni. Nessuna email verrà inviata automaticamente.</p>
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Operazione in corso…' : 'Genera invito'}</button>
        </form>
        {error && <p className="notice" role="alert">{error}</p>}
        {generated && <div className="generated-invite"><p>Condividi questo link con il destinatario. Copialo ora: non potrà essere recuperato in seguito.</p><label htmlFor="invite-link">Link d’invito</label><input id="invite-link" value={invitationLink(organization.id, generated.invite.id, generated.token)} readOnly onFocus={event => event.target.select()} /><button className="secondary" onClick={copy}>Copia link</button>{copyStatus && <p role="status">{copyStatus}</p>}</div>}
        <h5>Inviti</h5>{invites.length === 0 ? <p>Nessun invito per ora.</p> : <ul className="team-list" aria-label="Inviti dell’organizzazione">{invites.map(invite => <li key={invite.id}><strong>{invite.email}</strong><span>{invite.role} · {stateLabel[invite.status]}</span><span>Scadenza: {new Date(invite.expiresAt).toLocaleString('it-IT')}</span>{['PENDING', 'EXPIRED'].includes(invite.status) && <button className="text-button" disabled={busy} onClick={() => revoke(invite)} aria-label={`Revoca invito per ${invite.email}`}>Revoca invito</button>}</li>)}</ul>}
        <button className="text-button" disabled={busy} onClick={() => setAttempt(n => n + 1)}>Aggiorna team</button>
      </>}
    </div>}
  </section>;
}
