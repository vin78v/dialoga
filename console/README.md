# Console Dialoga

React, TypeScript e Vite. Login e logout con Keycloak tramite Authorization Code + PKCE S256. La console recupera il profilo applicativo da `/api/me`, gestisce sessione scaduta e retry degli errori API e ripristina l’accesso tramite SSO dopo un aggiornamento della pagina. Access token, refresh token e ID token restano in memoria; la libreria OIDC conserva temporaneamente soltanto i dati necessari a verificare il callback.

## Creazione dell’organizzazione

Dopo il login, la console mostra il modulo **Crea la tua organizzazione**. Il nome propone automaticamente uno slug modificabile; il backend crea l’organizzazione e la membership OWNER con una sola transazione. L’interfaccia impedisce invii concorrenti e conserva i dati del modulo se lo slug è occupato.

Dopo la creazione mostra nome, slug e ruolo restituiti dall’API. Il collegamento `/#organization=<uuid>` permette di riaprire la pagina; il callback OIDC rimane fisso alla radice e la destinazione viene conservata temporaneamente come solo UUID. L’ultima organizzazione viene ricordata in questo browser separatamente per utente, memorizzandone soltanto l’ID. L’API ricontrolla l’accesso a ogni caricamento: il ricordo locale non assegna ruoli né autorizzazioni. Se manca l’accesso, i dettagli vengono rimossi e viene proposto nuovamente l’onboarding.

Questa versione non include ancora un elenco di tutte le organizzazioni dell’utente: su un nuovo browser si può aprire il collegamento di un’organizzazione esistente. Se lo storage del browser è disabilitato, la creazione funziona ma il ripristino dopo il login/reload può non essere disponibile. Un errore di rete dopo l’invio non provoca un secondo POST automatico: l’esito può essere incerto, quindi verificare prima di ripetere l’operazione.

## Progetti

Nell’organizzazione, la sezione **Progetti** mostra l’elenco restituito dal backend. OWNER e ADMIN possono creare un progetto con nome, slug suggerito/modificabile e descrizione facoltativa. I MEMBER vedono solo i progetti assegnati e non hanno il pulsante di creazione; l’API verifica comunque i permessi, anche se il ruolo mostrato nella console fosse diventato obsoleto.

La creazione apre il dettaglio letto dall’API. I collegamenti `/#organization=<uuid>&project=<uuid>` vengono conservati attraverso il callback Keycloak e il reload, con **Torna ai progetti** per rientrare nell’elenco. Un progetto non accessibile non mostra nome o descrizione e permette di tornare alla lista. **Aggiorna elenco** rilegge i dati senza ripetere POST: usarlo anche se una creazione ha avuto un esito incerto per problemi di rete. Il modulo conserva i dati dopo un conflitto dello slug e non invia richieste concorrenti.

Dal dettaglio OWNER e ADMIN possono modificare nome e descrizione, archiviare il progetto e gestire le assegnazioni dei membri. I campi di ruolo e stato non sono selezionabili dal modulo.

## Membri e inviti

OWNER e ADMIN trovano **Membri e inviti** sotto i progetti. La sezione carica i dati soltanto all’apertura. Da qui è possibile vedere i membri, creare un invito MEMBER e revocare gli inviti in attesa; soltanto un OWNER può scegliere ADMIN. Il link generato si può copiare e condividere manualmente con il destinatario. Non viene inviata un’email. Il token viene mostrato soltanto alla creazione e resta in memoria nella schermata aperta: se lo si perde, revocare l’invito e rigenerarlo.

Chi apre il link deve accedere con un account Keycloak esistente e con email verificata uguale a quella invitata, quindi scegliere **Accetta invito**. Non viene eseguita un’accettazione automatica al caricamento. Il token viene rimosso dal fragment URL appena letto e conservato temporaneamente in sessionStorage nella stessa scheda durante il login; viene eliminato dopo successo, annullamento, logout esplicito o errore definitivo. Non finisce in localStorage né in query string o URL delle API. È necessario consentire sessionStorage per attraversare il redirect del login. Se si usa l’account sbagliato, uscire e riaprire il link con quello corretto.

Un’accettazione riuscita apre l’organizzazione e ne ricorda l’ID per il nuovo utente. L’invito non assegna progetti né modifica una membership già presente. La revoca di un invito accettato non rimuove un membro; ruoli, sospensione e riattivazione delle membership si gestiscono con azioni distinte nella stessa sezione.

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

Le prove coprono login reale con PKCE, profilo dall’API, ripristino SSO dopo reload, logout anche dal provider, credenziali errate, errore API con retry e risposta API 401. I sei test aggiuntivi dell’onboarding simulano le risposte delle API organizzazione e verificano creazione senza doppi invii, ripristino dopo reload, slug occupato, validazione, organizzazione non accessibile, retry e scadenza della sessione. Login e profilo usano servizi reali; una prova manuale completa in Chromium ha inoltre verificato POST reale, assegnazione OWNER e rilettura dopo reload. La suite comprende complessivamente 62 test browser: i sette casi aggiuntivi dei progetti verificano creazione senza doppi invii, elenco per MEMBER senza azione di creazione, validazione e conflitti di slug, retry, collegamenti non accessibili, permessi negati dal server e sessione scaduta. Le risposte delle API progetto sono simulate in questi sette casi; una prova separata in Chromium ha verificato creazione, elenco e dettaglio con API reali, oltre a conflitto 409 e isolamento tra organizzazioni 404.

## Build di distribuzione

`npm run build` genera `dist/`. Servire i file con fallback a `index.html` e un reverse proxy `/api` verso il backend, oppure impostare `VITE_API_URL` prima della build e autorizzare l’origine nel CORS del backend. Il proxy di Vite è solo per lo sviluppo; `npm run preview` serve esclusivamente a ispezionare i file statici e non avvia backend o Keycloak. Su domini remoti usare HTTPS e configurare gli indirizzi pubblici e i redirect per quell’ambiente.


## Gestione accessi al progetto

Dal dettaglio del progetto, OWNER e ADMIN possono aprire **Gestisci accessi**, scegliere un MEMBER attivo dell’organizzazione e assegnare uno dei ruoli VIEWER, OPERATOR, EDITOR o MANAGER. La selezione di un membro già assegnato precarica il ruolo attuale. **Rimuovi accesso** richiede una conferma e revoca soltanto l’accesso a quel progetto. OWNER e ADMIN mantengono l’accesso implicito; il MANAGER del progetto non gestisce le assegnazioni.

Cambio di ruolo e riattivazione rimuovono i permessi aggiuntivi precedenti; ripetere il salvataggio dello stesso ruolo attivo li conserva. La schermata mostra anche le assegnazioni non attive. Errori di rete consentono di ricaricare; risposte 403/404 alle modifiche rimuovono i dati del team caricati, mentre una sessione scaduta chiude lo spazio privato. Le autorizzazioni vengono sempre ricontrollate dal backend.

Gli otto test aggiuntivi simulano le API team/assegnazioni e verificano filtri dei destinatari, invio singolo, modifica del ruolo, conferma di revoca, controlli per MEMBER, permessi revocati, retry, destinatario non più attivo e sessione scaduta. Una prova separata in Chromium con due account e API reali ha verificato invito, assegnazione, visibilità del progetto, cambio di ruolo e revoca effettiva, anche controllando il layout desktop e mobile. Tutti i dati temporanei sono stati eliminati.


## Modifica e archiviazione

Nel dettaglio, OWNER e ADMIN possono usare **Modifica progetto** per aggiornare nome e descrizione. L’indirizzo rimane invariato. Il modulo precarica i dati, valida i limiti e mantiene i valori dopo un errore recuperabile. Il salvataggio aggiorna dettaglio ed elenco dopo la conferma dell’API.

**Archivia progetto** mostra una conferma con gli effetti dell’operazione. Dopo il successo, la console torna all’elenco aggiornato e mostra un messaggio. I dati vengono conservati, ma il progetto non è più accessibile e lo slug resta riservato. La sezione Progetti archiviati permette a OWNER/ADMIN di consultare gli archivi e ripristinarli con conferma. Il backend verifica i permessi a ogni richiesta: un MEMBER, anche MANAGER del progetto, non può modificare o archiviare.

Le risposte 403/404 alle modifiche rimuovono il dettaglio e il team caricati; una sessione scaduta chiude lo spazio privato. Un errore ambiguo invita a ricaricare lo stato prima di riprovare. Gli otto test aggiuntivi coprono salvataggio senza doppi invii, persistenza al reload, elenco aggiornato, conferma/annullamento dell’archiviazione, ruolo MEMBER, permessi obsoleti, risorsa non accessibile, retry, validazione e sessione scaduta. Le API progetto sono simulate in questi casi; una prova separata con servizi reali verifica il flusso completo, inclusi layout desktop/mobile e pulizia dei dati temporanei.


## Ruoli e sospensione dei membri

In **Membri e inviti**, gli OWNER possono scegliere **Cambia ruolo** per un membro attivo e impostare MEMBER, ADMIN oppure OWNER. OWNER e ADMIN attivi accedono a tutti i progetti. Solo un OWNER può modificare i ruoli; gli ADMIN possono sospendere e riattivare soltanto MEMBER. La console identifica il proprio account e non propone di sospenderlo.

Ogni operazione richiede conferma. Il cambio di ruolo e la sospensione rimuovono accessi espliciti ai progetti e permessi aggiuntivi e revocano gli inviti pendenti emessi dal membro. La riattivazione non li ripristina; un MEMBER deve essere assegnato nuovamente ai progetti. Per OWNER/ADMIN resta l’accesso implicito previsto dal ruolo. Deve rimanere almeno un OWNER con membership e account attivi: per passare la proprietà, nominare prima un altro OWNER, poi modificare il proprio ruolo. Il backend applica questi vincoli anche con richieste concorrenti.

Account globali non attivi non possono essere promossi o riattivati tramite la membership. Dopo un successo vengono aggiornati team e accessi ai progetti. Un cambio del proprio ruolo ricarica l’organizzazione e rimuove i controlli non più autorizzati. Dopo una sospensione, il link della stessa organizzazione permette di verificare nuovamente l’accesso quando il membro è stato riattivato. Errori recuperabili conservano la scelta senza mostrare modifiche non confermate; 403/404 rimuovono i dati del team e 401 chiude lo spazio privato.

Gli undici test aggiuntivi usano login reale e API simulate, incluso `/api/me` per identificare stabilmente l’utente corrente. Coprono promozione singola, conferme/annullamento, sospensione/riattivazione, limiti ADMIN/MEMBER, ultimo OWNER, cambio del proprio ruolo, permessi revocati, retry, account inattivi, sessione scaduta e rientro dalla stessa rotta. Una prova separata con due account e servizi reali verifica sospensione, mancato ripristino dei progetti, promozione/demozione, revoca degli inviti e passaggio di proprietà, con controllo desktop/mobile e pulizia dei dati temporanei.


## Progetti archiviati e ripristino

Sotto l’elenco dei progetti attivi, **Progetti archiviati** apre l’archivio per OWNER e ADMIN. La sezione carica i dati su richiesta e mostra nome, indirizzo e descrizione. **Ripristina progetto** apre una conferma: i membri con assegnazioni ancora attive potranno accedere nuovamente al progetto. Il ripristino mantiene ID e dati e non ricrea accessi revocati, grant eliminati o membership sospese; restano validi i controlli su account e organizzazione attivi.

Dopo il successo viene aperto il dettaglio attivo, riletto dall’API, e l’elenco viene aggiornato. L’archivio può essere aggiornato manualmente; errori di caricamento permettono di riprovare. Un esito ambiguo del ripristino invita a rileggere lo stato prima di ripetere l’operazione. Risposte 403/404 rimuovono i metadati precedentemente caricati e 401 chiude lo spazio privato. Chiusura o cambio organizzazione invalidano le letture pendenti. La vista non offre modifica o gestione dei membri per un progetto ancora archiviato.

I dieci test aggiuntivi usano login reale e API simulate per coprire caricamento su richiesta, metadati e archivio vuoto, conferma/annullamento, doppi eventi con un solo POST, dettaglio/elenco/reload, ruoli ADMIN e MEMBER, permessi revocati, retry, sessione scaduta e navigazione durante una lettura pendente. Una prova separata con due account e servizi reali verifica anche che un’assegnazione valida torni utilizzabile e che una sospensione/riattivazione durante l’archiviazione non ripristini vecchi accessi. Verificati layout desktop/mobile e pulizia delle fixture.
