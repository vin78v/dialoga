import { useEffect, useRef, useState } from 'react';
import { SessionExpired } from './auth';
import type { PendingInvitation } from './invitation';
import { clearInvitation } from './invitation';
import type { Organization } from './organizations';
import { acceptInvite, TeamError } from './team';
export function InvitationPanel({ invitation, onAccepted, onCancel, onExpired }: { invitation: PendingInvitation; onAccepted: (organization: Organization) => void; onCancel: () => void; onExpired: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminal, setTerminal] = useState(false);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function accept() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    const abort = new AbortController(); controller.current = abort;
    try {
      const organization = await acceptInvite(invitation.organizationId, invitation.inviteId, invitation.token, abort.signal);
      if (!abort.signal.aborted) { clearInvitation(); onAccepted(organization); }
    } catch (error) {
      if (abort.signal.aborted) return;
      if (error instanceof SessionExpired) onExpired();
      else {
        setError(error instanceof TeamError ? error.message : 'Connessione interrotta. Puoi riprovare: l’accettazione è sicura per lo stesso account.');
        if (error instanceof TeamError && [404, 409, 410].includes(error.status)) { clearInvitation(); setTerminal(true); }
      }
    } finally { inFlight.current = false; if (!abort.signal.aborted) setBusy(false); }
  }
  return <section className="organization-panel invitation-panel" aria-labelledby="invitation-title">
    <p className="eyebrow">UN NUOVO SPAZIO, INSIEME</p><h3 id="invitation-title">Hai ricevuto un invito</h3>
    <p>Accetta per entrare nell’organizzazione. L’email verificata del tuo account deve corrispondere al destinatario.</p>
    {error && <p className="notice" role="alert">{error}</p>}
    {!terminal && <button className="primary" onClick={accept} disabled={busy}>{busy ? 'Accettazione in corso…' : 'Accetta invito'}</button>}
    <button className="secondary" onClick={onCancel} disabled={busy}>{terminal ? 'Chiudi invito' : 'Annulla invito'}</button>
  </section>;
}
