import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { auth, initializeAuth, loadProfile, redirectUri, SessionExpired, type Profile } from './auth';
import './style.css';
import { OrganizationPanel } from './OrganizationPanel';
import { InvitationPanel } from './InvitationPanel';
import { clearInvitation, readInvitation } from './invitation';
import { rememberOrganization } from './organizations';

type Session =
  | { kind: 'loading' }
  | { kind: 'guest'; message?: string }
  | { kind: 'ready'; profile: Profile }
  | { kind: 'error'; message: string; authenticated: boolean };

function App() {
  const [session, setSession] = useState<Session>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [invitation, setInvitation] = useState(() => readInvitation());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const expired = () => {
      auth.clearToken();
      if (active) setSession({ kind: 'guest', message: 'La sessione è scaduta. Accedi di nuovo per continuare.' });
    };
    auth.onAuthLogout = () => active && setSession({ kind: 'guest' });
    auth.onAuthRefreshError = expired;
    auth.onTokenExpired = () => { void auth.updateToken(30).catch(expired); };

    async function start() {
      setSession({ kind: 'loading' });
      try {
        await initializeAuth();
        if (!auth.authenticated) {
          if (active) setSession({ kind: 'guest' });
          return;
        }
        const profile = await loadProfile(controller.signal);
        if (active) setSession({ kind: 'ready', profile });
      } catch (error) {
        if (!active) return;
        if (error instanceof SessionExpired) expired();
        else setSession({ kind: 'error', authenticated: !!auth.authenticated,
          message: error instanceof Error && error.message ? error.message : 'Accesso non riuscito. Riprova.' });
      }
    }
    void start();
    return () => { active = false; controller.abort(); };
  }, [attempt]);

  async function login() {
    setBusy(true);
    try { await auth.login({ redirectUri }); }
    catch { setSession({ kind: 'error', authenticated: false, message: 'Impossibile aprire la pagina di accesso. Riprova.' }); setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try {
      // Build the RP-initiated logout URL before clearing the in-memory ID/access tokens.
      const url = auth.createLogoutUrl({ redirectUri });
      if (invitation) { clearInvitation(); setInvitation(null); }
      auth.clearToken();
      setSession({ kind: 'guest' });
      window.location.assign(url);
    } catch {
      setSession({ kind: 'error', authenticated: !!auth.authenticated, message: 'Uscita non completata. Riprova per chiudere la sessione.' });
      setBusy(false);
    }
  }

  const signedIn = session.kind === 'ready' || (session.kind === 'error' && session.authenticated);
  return (
    <div className="shell">
      <header className="header">
        <a className="brand" href="/" aria-label="Dialoga, pagina iniziale"><span className="brand-icon" aria-hidden="true">d.</span>dialoga<span className="console-label">Console</span></a>
        <span className="header-note">Il tuo spazio di lavoro</span>
      </header>
      <main>
        <section className="intro">
          <p className="eyebrow">CONNESSIONI CHE CONTANO</p>
          <h1>Ogni dialogo,<br />un nuovo inizio<span>.</span></h1>
          <p className="description">Uno spazio per le tue idee, le tue persone e le conversazioni che fanno crescere il tuo progetto.</p>
          <div className="conversation" aria-hidden="true"><div>Da dove iniziamo?</div><div>Da una buona conversazione.</div><span>● ● ●</span></div>
          <p className="intro-footer">Meno distanze. Più possibilità.</p>
        </section>
        <section className="access-card" aria-labelledby="card-title" aria-busy={session.kind === 'loading' || busy}>
          <div className="card-mark" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 18 18 6M6 6h12v12" /></svg></div>
          {session.kind === 'loading' ? <><p className="eyebrow">UN MOMENTO</p><h2 id="card-title">Prepariamo il tuo spazio</h2><p role="status">Verifica della sessione in corso…</p></> : session.kind === 'ready' ? <>
            <span className="status-pill">Sessione attiva</span>
            <h2 id="card-title">Ciao, {session.profile.firstName || 'bentornato'}.</h2>
            <p>Hai effettuato l’accesso al tuo spazio Dialoga.</p>
            <dl className="profile"><dt>Il tuo account</dt><dd>{session.profile.email}</dd></dl>
            {invitation ? <InvitationPanel invitation={invitation} onAccepted={organization => {
              rememberOrganization(session.profile.id, organization.id);
              window.location.hash = `organization=${organization.id}`;
              setInvitation(null);
            }} onCancel={() => { clearInvitation(); setInvitation(null); }} onExpired={() => setSession({ kind: 'guest', message: 'La sessione è scaduta. Accedi di nuovo per continuare.' })} /> :
              <OrganizationPanel key={session.profile.id} userId={session.profile.id} onExpired={() => setSession({ kind: 'guest', message: 'La sessione è scaduta. Accedi di nuovo per continuare.' })} />}
            <button className="secondary" onClick={logout} disabled={busy}>{busy ? 'Uscita in corso…' : 'Esci'}</button>
            <p className="card-footnote">Uscirai da Dialoga e dalla sessione di accesso.</p>
          </> : <>
            <p className="eyebrow">BENVENUTO IN DIALOGA</p>
            <h2 id="card-title">Il prossimo passo<br />inizia da qui.</h2>
            <p>Accedi al tuo account per entrare nel tuo spazio di lavoro.</p>
            {invitation && <p className="notice">Hai ricevuto un invito. Accedi con l’email del destinatario per continuare.</p>}
            {session.kind === 'guest' && session.message && <p className="notice" role="status">{session.message}</p>}
            {session.kind === 'error' && <p className="notice" role="alert">{session.message}</p>}
            {signedIn ? <><button className="primary" onClick={() => setAttempt(n => n + 1)}>Riprova</button><button className="secondary" onClick={logout} disabled={busy}>Esci</button></> : <button className="primary" onClick={login} disabled={busy}>{busy ? 'Accesso in corso…' : 'Accedi'}<span aria-hidden="true">→</span></button>}
            <p className="card-footnote">Un accesso sicuro, uno spazio tutto tuo.</p>
          </>}
        </section>
      </main>
      <footer className="footer"><span>Dialoga · Spazio alle conversazioni.</span><span>Costruiamo connessioni, insieme.</span></footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
