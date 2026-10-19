# Console Dialoga

React, TypeScript e Vite. Login e logout con Keycloak tramite Authorization Code + PKCE S256. La console recupera il profilo applicativo da `/api/me`, gestisce sessione scaduta e retry degli errori API e ripristina l’accesso tramite SSO dopo un aggiornamento della pagina. Access token, refresh token e ID token restano in memoria; la libreria OIDC conserva temporaneamente soltanto i dati necessari a verificare il callback.

## Creazione dell’organizzazione

Dopo il login, la console mostra il modulo **Crea la tua organizzazione**. Il nome propone automaticamente uno slug modificabile; il backend crea l’organizzazione e la membership OWNER con una sola transazione. L’interfaccia impedisce invii concorrenti e conserva i dati del modulo se lo slug è occupato.

Dopo la creazione mostra nome, slug e ruolo restituiti dall’API. Il collegamento `/#organization=<uuid>` permette di riaprire la pagina; il callback OIDC rimane fisso alla radice e la destinazione viene conservata temporaneamente come solo UUID. L’ultima organizzazione viene ricordata in questo browser separatamente per utente, memorizzandone soltanto l’ID. L’API ricontrolla l’accesso a ogni caricamento: il ricordo locale non assegna ruoli né autorizzazioni. Se manca l’accesso, i dettagli vengono rimossi e viene proposto nuovamente l’onboarding.

Questa versione non include ancora un elenco di tutte le organizzazioni dell’utente: su un nuovo browser si può aprire il collegamento di un’organizzazione esistente. Se lo storage del browser è disabilitato, la creazione funziona ma il ripristino dopo il login/reload può non essere disponibile. Un errore di rete dopo l’invio non provoca un secondo POST automatico: l’esito può essere incerto, quindi verificare prima di ripetere l’operazione.

## Progetti

Nell’organizzazione, la sezione **Progetti** mostra l’elenco restituito dal backend. OWNER e ADMIN possono creare un progetto con nome, slug suggerito/modificabile e descrizione facoltativa. I MEMBER vedono solo i progetti assegnati e non hanno il pulsante di creazione; l’API verifica comunque i permessi, anche se il ruolo mostrato nella console fosse diventato obsoleto.

La creazione apre il dettaglio letto dall’API. I collegamenti `/#organization=<uuid>&project=<uuid>` vengono conservati attraverso il callback Keycloak e il reload, con **Torna ai progetti** per rientrare nell’elenco. Un progetto non accessibile non mostra nome o descrizione e permette di tornare alla lista. **Aggiorna elenco** rilegge i dati senza ripetere POST: usarlo anche se una creazione ha avuto un esito incerto per problemi di rete. Il modulo conserva i dati dopo un conflitto dello slug e non invia richieste concorrenti.

Questa versione non include ancora modifica, archiviazione o assegnazione dei membri. I campi di ruolo e stato non sono selezionabili dal modulo.

## Membri e inviti

OWNER e ADMIN trovano **Membri e inviti** sotto i progetti. La sezione carica i dati soltanto all’apertura. Da qui è possibile vedere i membri, creare un invito MEMBER e revocare gli inviti in attesa; soltanto un OWNER può scegliere ADMIN. Il link generato si può copiare e condividere manualmente con il destinatario. Non viene inviata un’email. Il token viene mostrato soltanto alla creazione e resta in memoria nella schermata aperta: se lo si perde, revocare l’invito e rigenerarlo.

Chi apre il link deve accedere con un account Keycloak esistente e con email verificata uguale a quella invitata, quindi scegliere **Accetta invito**. Non viene eseguita un’accettazione automatica al caricamento. Il token viene rimosso dal fragment URL appena letto e conservato temporaneamente in sessionStorage nella stessa scheda durante il login; viene eliminato dopo successo, annullamento, logout esplicito o errore definitivo. Non finisce in localStorage né in query string o URL delle API. È necessario consentire sessionStorage per attraversare il redirect del login. Se si usa l’account sbagliato, uscire e riaprire il link con quello corretto.

Un’accettazione riuscita apre l’organizzazione e ne ricorda l’ID per il nuovo utente. L’invito non assegna progetti né modifica una membership già presente. La revoca di un invito accettato non rimuove un membro; la gestione dei ruoli e della sospensione delle membership è una funzionalità distinta, non ancora esposta.

Gli otto test browser aggiuntivi del team verificano generazione senza doppi invii, copia/revoca, ruoli, duplicati, passaggio attraverso Keycloak, consenso esplicito, email errata, scadenza, dati negati dal server e gestione di un link malformato. Le API team sono simulate in questi test; una prova separata con Keycloak e API reali ha creato un destinatario temporaneo, rifiutato l’account sbagliato, accettato con email verificata e verificato la membership MEMBER. Tutti i dati temporanei sono stati eliminati.

## Avvio locale

Richiede Node.js 22.12+ e backend/PostgreSQL/Keycloak avviati secondo il README principale.

```sh
cd console
npm ci
npm run dev
```

Vite usa la porta 5173 e inoltra `/api` al backend sulla porta 8080. Le impostazioni predefinite sono in `.env.example`; per cambiarle creare `.env.local` (ignorato da Git) e riavviare Vite. Non mettere client secret o altre credenziali nelle variabili `VITE_*`: sono pubbliche nel browser.

Il realm include il client pubblico `dialoga-console`, con password grant e implicit flow disabilitati, PKCE S256 obbligatorio, audience `dialoga-api` e redirect di login/logout esatti verso `http://localhost:5173/`.

Il realm viene importato soltanto alla creazione. Per aggiungere o aggiornare il client su un Keycloak locale già avviato, eseguire dalla radice del repository:

```sh
DIALOGA_KEYCLOAK_ADMIN=admin \
DIALOGA_KEYCLOAK_ADMIN_PASSWORD=dialoga-admin-local \
python keycloak/configure-console.py
```

Sono le sole credenziali dimostrative del test kit. Lo script modifica il client browser senza cancellare utenti o realm. Non reimportare il realm né eliminare i volumi per aggiornarlo.

Keycloak deve pubblicare un hostname raggiungibile dal browser, identico all’issuer validato dal backend. Compose usa la porta pubblica 8081 come issuer e un URL interno separato per recuperare le chiavi JWT. Per un’origine diversa, configurare esplicitamente `redirectUris`, `webOrigins` e `post.logout.redirect.uris` nel client, `VITE_KEYCLOAK_URL` nella console e issuer/JWK URL nel backend. I redirect sono limitati alla radice dell’origine della console; non sono accettati URL arbitrari dai parametri della pagina.

## Verifiche

```sh
npm run build
npx playwright install chromium
npm run test:e2e
```

Se Chromium è già installato, usare `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e`. Playwright avvia Vite; backend e Keycloak devono essere già disponibili. I test utilizzano l’utente dimostrativo del realm; `DIALOGA_TEST_USERNAME` e `DIALOGA_TEST_PASSWORD` permettono di usare un utente di test differente. Eseguire contro un ambiente locale di test.

Le prove coprono login reale con PKCE, profilo dall’API, ripristino SSO dopo reload, logout anche dal provider, credenziali errate, errore API con retry e risposta API 401. I sei test aggiuntivi dell’onboarding simulano le risposte delle API organizzazione e verificano creazione senza doppi invii, ripristino dopo reload, slug occupato, validazione, organizzazione non accessibile, retry e scadenza della sessione. Login e profilo usano servizi reali; una prova manuale completa in Chromium ha inoltre verificato POST reale, assegnazione OWNER e rilettura dopo reload. La suite comprende complessivamente 25 test browser: i sette casi aggiuntivi dei progetti verificano creazione senza doppi invii, elenco per MEMBER senza azione di creazione, validazione e conflitti di slug, retry, collegamenti non accessibili, permessi negati dal server e sessione scaduta. Le risposte delle API progetto sono simulate in questi sette casi; una prova separata in Chromium ha verificato creazione, elenco e dettaglio con API reali, oltre a conflitto 409 e isolamento tra organizzazioni 404.

## Build di distribuzione

`npm run build` genera `dist/`. Servire i file con fallback a `index.html` e un reverse proxy `/api` verso il backend, oppure impostare `VITE_API_URL` prima della build e autorizzare l’origine nel CORS del backend. Il proxy di Vite è solo per lo sviluppo; `npm run preview` serve esclusivamente a ispezionare i file statici e non avvia backend o Keycloak. Su domini remoti usare HTTPS e configurare gli indirizzi pubblici e i redirect per quell’ambiente.
