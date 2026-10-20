# Dialoga backend security starter

Starter Java per il prossimo passaggio del progetto Dialoga: validazione di access token Keycloak, risoluzione dell'identità applicativa e autorizzazione a livello di progetto.

## Scelte implementate

- Java 21, Spring Boot 4.1.1, Spring Security Resource Server e PostgreSQL.
- Il bearer JWT viene validato da Spring Security; issuer e audience sono configurati in `application.yml`.
- `issuer + subject` individua `user_identity`. L'email non collega identità esistenti; per un nuovo utente si richiede `email_verified=true`.
- Primo accesso serializzato con advisory lock PostgreSQL; `app_user` e `user_identity` vengono creati nella stessa transazione.
- `app_user.status` viene controllato a ogni richiesta autenticata. I ruoli nel JWT non vengono usati.
- `ProjectAuthorizationService` verifica stato utente, membership, organizzazione, progetto e azione; imposta il contesto RLS transazionale per V3.
- La migrazione V4 aggiunge grant esplicito `PERSONAL_DATA_EXPORT`, valido anche per OWNER/ADMIN senza membership progetto; la policy richiede inoltre il diritto di lettura specifico per esportare conversazioni o contatti.
- `GET /api/me` restituisce il profilo applicativo autenticato. CORS per `/api/**` usa la allowlist `DIALOGA_CONSOLE_ORIGINS`; non abilita wildcard. Le chat pubbliche sono lasciate come rotta da sviluppare e i loro domini andranno verificati contro `assistant_domain`.

## Configurazione locale

Il test rapido usa Docker Compose e non richiede installare JDK o Maven sul PC. Il container compila con JDK 21 e lancia `mvn verify` durante la build. Se preferisci eseguire l’app fuori da Docker, servono JDK 21, Maven 3.6.3+ e PostgreSQL 16. Gli script inclusi vanno applicati con un utente di migrazione: V1, V3, V4 e V5, in quest’ordine. V2 resta opzionale e serve solo per pgvector. Il realm Keycloak deve emettere token con `iss` corrispondente a `DIALOGA_OIDC_ISSUER` e `aud` contenente `DIALOGA_API_AUDIENCE` (default `dialoga-api`).

```sh
export DIALOGA_DB_URL=jdbc:postgresql://localhost:5432/dialoga
export DIALOGA_DB_USERNAME=dialoga_app
export DIALOGA_DB_PASSWORD='...'
export DIALOGA_OIDC_ISSUER=https://auth.example/realms/dialoga
export DIALOGA_API_AUDIENCE=dialoga-api
mvn test
mvn spring-boot:run
```

`dialoga_app` deve essere un utente runtime non privilegiato, diverso dal proprietario delle migrazioni; non usare superuser o `BYPASSRLS`. Prima di abilitare V3 in un ambiente, configurare i grant SQL e verificare i permessi del ruolo runtime.

## Limiti attuali

Questo è un nucleo di sicurezza, non l'applicazione SaaS completa. L’onboarding crea un’organizzazione e la membership OWNER su richiesta autenticata. La console web include login, logout, profilo e creazione dell’organizzazione; include elenco, creazione, modifica, archiviazione e ripristino dei progetti; include elenco dei membri, inviti con accettazione e gestione degli accessi ai progetti; include cambio ruolo, sospensione e riattivazione dei membri; include creazione, elenco, dettaglio e modifica degli assistenti in bozza. I test includono la matrice di autorizzazione e prove PostgreSQL opzionali per l’onboarding; queste ultime richiedono un database dedicato. Build, test e richieste HTTP con Keycloak sono stati verificati nell’ambiente cloud con JDK 21 e Maven. Non pubblicare il servizio finché issuer, audience, CORS, database runtime e realm non sono configurati per l'ambiente previsto.

## Riferimenti

- Spring Security Resource Server JWT: https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html
- Spring Boot 4 web MVC starter: https://docs.spring.io/spring-boot/4.0/reference/web/index.html
- Keycloak OIDC layers: https://www.keycloak.org/securing-apps/oidc-layers


## Prova locale end-to-end (solo sviluppo)

Serve Docker Desktop o Docker Engine con Compose. Non occorre installare Java/Maven sul PC: il Dockerfile compila con JDK 21. Keycloak gira in `start-dev` e importa il realm del test kit all'avvio; questo è solo per prove locali.

1. Aprire un terminale nella cartella `dialoga-backend-security` estratta dallo ZIP.
2. Avviare PostgreSQL, Keycloak e backend:

   ```sh
   docker compose up --build
   ```

3. Durante la build Maven esegue anche i test unitari. Attendere nei log `keycloak` che il server sia in ascolto e nei log `backend` che Spring Boot sia avviato. Keycloak è su `http://localhost:8081`, backend su `http://localhost:8080`.
4. Verificare che l'API respinga una richiesta senza token: `curl -i http://localhost:8080/api/me` deve restituire `401`.
5. Richiedere un access token al client locale di prova e chiamare `/api/me`:

   ```sh
   TOKEN=$(curl -s -X POST http://localhost:8081/realms/dialoga/protocol/openid-connect/token \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -d 'grant_type=password&client_id=dialoga-test-cli&username=dialoga-test&password=dialoga-local-password' \
     | python -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
   curl -i -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/me
   ```

   La prima chiamata autenticata deve restituire `200` e creare `app_user` + `user_identity`; ripetendola, l'ID restituito deve restare identico.
6. Arrestare i servizi con `Ctrl+C`; rimuovere anche il database locale di prova con `docker compose down -v` se si vuole ripartire da zero. Questo elimina il volume PostgreSQL locale.

La password grant e le credenziali `dialoga-test` esistono esclusivamente per semplificare il test via curl. Per la console reale va configurato un client browser con Authorization Code + PKCE; non riutilizzare questo client di test fuori dall'ambiente locale.

PowerShell, dopo `docker compose up --build`:

```powershell
$body = @{ grant_type='password'; client_id='dialoga-test-cli'; username='dialoga-test'; password='dialoga-local-password' }
$token = (Invoke-RestMethod -Method Post -Uri 'http://localhost:8081/realms/dialoga/protocol/openid-connect/token' -Body $body).access_token
Invoke-RestMethod -Headers @{ Authorization = "Bearer $token" } -Uri 'http://localhost:8080/api/me'
```

Questa prova verifica Keycloak → JWT → validazione issuer/audience → lookup/provisioning `issuer + subject` → `/api/me`. La policy progetto ha test unitari, ma non è ancora collegata a un endpoint REST per la prova manuale. Il test kit usa Keycloak `start-dev`, password locali note e PostgreSQL di sviluppo: non è una configurazione di produzione.

## Prova con GitHub Codespaces

Questa configurazione avvia un ambiente Linux cloud con Docker Compose già disponibile. Non devi installare Docker o Java sul computer. Il test kit continua a usare credenziali e dati esclusivamente dimostrativi.

1. Crea un repository **privato** su GitHub.
2. Estrai `Dialoga_Codespaces_Testkit_v1.zip` e carica nel repository il contenuto della cartella, compresa la cartella nascosta `.devcontainer` (deve trovarsi alla radice del repository). In alternativa, usa GitHub Desktop o Git per aggiungere e pubblicare i file.
3. Nel repository, scegli **Code → Codespaces → Create codespace on main**. Attendi che l'ambiente termini la configurazione.
4. Apri il terminale del Codespace ed esegui:

   ```sh
   docker compose up --build
   ```

5. Quando il backend è avviato, controlla l'API dal terminale del Codespace:

   ```sh
   curl -i http://localhost:8080/api/me
   ```

   Senza token deve rispondere `401`. Per la prova autenticata, usa i comandi curl della sezione precedente: gli indirizzi `localhost:8080` e `localhost:8081` funzionano anche dentro il terminale del Codespace.
6. Nella scheda **Ports**, mantieni `8080` e `8081` su **Private**. La configurazione li inoltra automaticamente per comodità, ma non serve renderli pubblici per la prova da terminale.
7. Ferma i servizi con `Ctrl+C`; esegui `docker compose down -v` per eliminare anche il database di prova. Arresta poi il Codespace dal menu GitHub quando hai finito, così non resta in esecuzione.

Il flusso incluso è una prova da terminale con token di test; non configura ancora l'accesso Keycloak tramite una pagina web. Codespaces richiede un repository GitHub e consuma la quota di calcolo del tuo account.


## Onboarding organizzazione

Dopo il login, creare un’organizzazione con `POST /api/organizations`:

```sh
curl -i http://localhost:8080/api/organizations \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"La mia organizzazione","slug":"mia-organizzazione"}'
```

Risposta `201 Created`, header `Location: /api/organizations/<id>` e corpo:

```json
{"id":"<uuid>","name":"La mia organizzazione","slug":"mia-organizzazione","role":"OWNER"}
```

Il nome viene ripulito dagli spazi iniziali e finali e deve avere 1–160 caratteri. Lo slug deve avere 1–63 caratteri ASCII minuscoli o numerici, con trattini singoli tra segmenti. Il proprietario è sempre l’utente autenticato; il client non può scegliere utente, ruolo o ID dell’organizzazione. Creazione e membership ACTIVE/OWNER sono atomiche, con contesto RLS locale alla transazione. Non vengono creati progetti o assegnati permessi aggiuntivi.

- `400`: nome/slug non validi o JSON non valido.
- `401`: autenticazione mancante o token non valido.
- `403`: account non attivo.
- `409`: slug già occupato, anche per richieste ripetute o concorrenti; nessuna adesione automatica a organizzazioni esistenti.

`GET /api/organizations/<id>` restituisce la stessa rappresentazione a un membro attivo di un’organizzazione attiva. Restituisce `404` per organizzazioni inesistenti o non accessibili.

### Migrazione di database esistenti

Compose applica V5 automaticamente **solo su volumi nuovi**. Su database esistenti, eseguire con il migration owner, senza eliminare i volumi:

```sh
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U dialoga_migration -d dialoga \
  < src/main/resources/db/migration/V5__organization_trigger_search_path.sql
```

V5 fissa il `search_path` dei trigger di membership e vincolo OWNER, mantenendo RLS e i privilegi del chiamante. Non è presente un runner automatico delle migrazioni nell’applicazione.

### Test PostgreSQL dell’onboarding e dei progetti e dei progetti

`mvn verify` esegue i test unitari; gli 85 test PostgreSQL (5 organizzazioni, 17 progetti, 10 ripristino progetti, 29 team/inviti, 12 assegnazioni ai progetti e 12 assistenti) vengono saltati se `DIALOGA_TEST_DB_URL` non è impostata. Per eseguirli, preparare un **database di test dedicato**, con V1, V3, V4, V5 e grant DML per un ruolo runtime senza superuser/BYPASSRLS. Esempio con il database Compose già avviato e il ruolo `dialoga_app` già creato:

```sh
docker compose exec -T db createdb -U dialoga_migration dialoga_onboarding_test
for migration in db-reference/V1__dialoga_schema.sql \
  db-reference/V3__optional_tenant_rls.sql \
  src/main/resources/db/migration/V4__project_user_permission.sql \
  src/main/resources/db/migration/V5__organization_trigger_search_path.sql; do
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U dialoga_migration \
    -d dialoga_onboarding_test < "$migration" || break
done
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U dialoga_migration \
  -d dialoga_onboarding_test -c 'GRANT CONNECT ON DATABASE dialoga_onboarding_test TO dialoga_app; GRANT USAGE ON SCHEMA dialoga TO dialoga_app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA dialoga TO dialoga_app;'
DIALOGA_TEST_DB_URL=jdbc:postgresql://localhost:5432/dialoga_onboarding_test \
DIALOGA_TEST_DB_USERNAME=dialoga_app DIALOGA_TEST_DB_PASSWORD=dialoga_local_app mvn verify
```

La preparazione va eseguita una sola volta su un database nuovo; le successive esecuzioni dei test creano e ripuliscono i propri dati. Le prove verificano commit con OWNER attivo, isolamento da non membri, collisioni di slug, richieste concorrenti, rollback atomico e account sospesi.


## Console web: login e logout

La cartella [`console`](console/README.md) contiene la console React/TypeScript. Dopo aver avviato i servizi, eseguire `npm ci` e `npm run dev` da `console`. Il pulsante **Accedi** apre Keycloak con Authorization Code + PKCE; dopo il login mostra il profilo restituito da `/api/me`. **Esci** rimuove i token dalla memoria e chiude la sessione Keycloak. Il test kit usa un client browser dedicato, `dialoga-console`, separato dal client password grant per le prove da terminale.

Su un realm esistente, aggiungere il client con `keycloak/configure-console.py`, come descritto nel README della console. Non è necessario ricreare il database. Le istruzioni includono configurazione degli indirizzi, build e test browser Playwright.


La console collega anche l’onboarding: dopo il login consente di creare un’organizzazione, mostra il ruolo OWNER e permette di riaprirla da un collegamento dedicato. L’ultima organizzazione è ricordata per utente nel browser, ma ogni lettura passa sempre dalle verifiche di accesso del backend. Per dettagli e limiti del ripristino consultare il [README della console](console/README.md#creazione-dellorganizzazione).


## Progetti nell’organizzazione

La console mostra i progetti sotto l’organizzazione attiva. OWNER e ADMIN possono usare **Nuovo progetto**; un MEMBER vede soltanto i progetti con membership progetto attiva. La creazione richiede nome (1–160 caratteri), slug (1–63 caratteri, minuscole ASCII/numeri/trattini singoli) e descrizione facoltativa (massimo 2000 caratteri). Nome e descrizione vengono ripuliti dagli spazi alle estremità; una descrizione vuota viene salvata come null.

| Metodo | Endpoint | Risultato |
| --- | --- | --- |
| GET | `/api/organizations/{organizationId}/projects` | Array dei progetti attivi visibili, dal più recente |
| POST | `/api/organizations/{organizationId}/projects` | `201 Created`, progetto e header Location |
| GET | `/api/organizations/{organizationId}/projects/{projectId}` | Dettaglio di un progetto attivo accessibile |

Esempio corpo POST:

```json
{"name":"Assistenza clienti","slug":"assistenza-clienti","description":"Conversazioni e supporto clienti"}
```

La risposta contiene `id`, `organizationId`, `name`, `slug`, `description` e `status`. L’organizzazione viene sempre presa dal percorso e il ruolo è verificato nel database; né ruolo né ID forniti nel JSON assegnano autorizzazioni. OWNER/ADMIN accedono senza una membership progetto aggiuntiva. Gli altri membri devono avere una membership progetto ACTIVE, oltre a quella organizzazione e al proprio account attivi.

Dati non validi producono `400`; autenticazione mancante/non valida `401`; un membro regolare che tenta di creare un progetto riceve `403`. Organizzazioni e progetti inesistenti o non accessibili producono `404`, anche se l’ID del progetto esiste in un’altra organizzazione. Slug duplicati nella stessa organizzazione producono `409`; lo stesso slug è consentito in organizzazioni differenti. Uno slug rimane riservato anche se il relativo progetto è archiviato. Le API ordinarie di elenco e dettaglio mostrano soltanto progetti attivi; gli archivi hanno un endpoint dedicato per OWNER/ADMIN.

Questa versione include elenco, creazione, dettaglio, modifica, archiviazione e ripristino, con refresh dell’elenco, gestione degli errori e collegamenti `/#organization=<uuid>&project=<uuid>`. Gli accessi dei membri si gestiscono dal dettaglio del progetto. Non serve una nuova migrazione: vengono usate le tabelle esistenti, mantenendo V3 RLS e V5 attive. `mvn verify` con il database di test configurato esegue 102 test senza skip; senza database esegue 17 test e salta le 85 prove PostgreSQL.


## Membri e inviti

La sezione **Membri e inviti**, visibile a OWNER e ADMIN, mostra membri e stati delle membership, permette di generare un link e di revocare un invito ancora non accettato. Gli ADMIN possono invitare MEMBER; soltanto gli OWNER possono invitare anche ADMIN. Il ruolo OWNER non è assegnabile tramite invito. Gli inviti non assegnano automaticamente progetti, non promuovono membri esistenti e non riattivano membership sospese.

| Metodo | Endpoint | Risultato |
| --- | --- | --- |
| GET | `/api/organizations/{org}/members` | Membri con ruolo, stato membership e stato account; solo OWNER/ADMIN |
| GET | `/api/organizations/{org}/invites` | Metadati degli inviti, senza token o hash |
| GET | `/api/organizations/{org}/invites/{id}` | Metadati di un singolo invito; solo OWNER/ADMIN |
| POST | `/api/organizations/{org}/invites` | `201`, `{invite, token}` e Location; token restituito una sola volta |
| DELETE | `/api/organizations/{org}/invites/{id}` | `204`, revoca idempotente; un invito accettato produce `409` |
| POST | `/api/organizations/{org}/invites/{id}/accept` | `200`, organizzazione e ruolo dell’utente che ha accettato |

Creazione: `{"email":"persona@example.test","role":"MEMBER"}`. Accettazione: `{"token":"<token ricevuto>"}`. L’email non arriva dal JSON: il backend usa il claim corrente `email` del JWT validato e richiede `email_verified=true`, confrontandolo con il destinatario senza distinguere maiuscole/minuscole. Nessun collegamento di identità esistenti viene fatto per email. Un primo accesso senza email verificata viene rifiutato in autenticazione con `401`; un account già risolto che non soddisfa il controllo dell’invito riceve `403`.

Il token casuale contiene 256 bit di entropia ed è conservato nel database solo come SHA-256. Non viene restituito da GET, né ricostruito in seguito. L’invito dura sette giorni. Un invito pendente per la stessa email, nella stessa organizzazione, produce `409`; un vecchio invito scaduto viene revocato prima di consentire una nuova emissione. Lo stato `EXPIRED` è calcolato per la lettura, senza richiedere un job o una nuova migrazione.

Il link usa il fragment della console: `/#organization=<uuid>&invite=<uuid>&token=<token>`. La console lo ripulisce appena caricato e conserva temporaneamente il token in sessionStorage, nella stessa scheda, per completare il login Keycloak. Il token viene inviato soltanto nel corpo POST dell’accettazione e viene rimosso dopo successo, annullamento, uscita esplicita o errore definitivo. Il link va condiviso manualmente: questa versione **non invia email**. Se il link viene perso, revocare l’invito e generarne uno nuovo.

L’accettazione è esplicita, transazionale e serializzata con la revoca. Controlla organizzazione e account attivi, token, scadenza, email verificata e permessi attuali dell’autore dell’invito. Crea una sola membership e registra il consumo nello stesso commit. Un retry dello stesso account dopo un successo è idempotente e restituisce soltanto una membership ancora attiva, senza ripristinare ruoli o stati. Altre identità, anche con la stessa email, non possono riutilizzare un invito consumato. Token invalidi o risorse di un’altra organizzazione producono `404`; inviti scaduti/revocati/non più utilizzabili producono `410`.

Nel realm di sviluppo la registrazione pubblica è disabilitata: il destinatario deve già avere un account Keycloak con email verificata. Non sono inclusi servizio email o registrazione pubblica. Ruoli e sospensioni dei membri si gestiscono dalla sezione team. Le risposte contenenti dati del team e token usano `Cache-Control: no-store`. Le prove aggiuntive coprono anche doppia accettazione, revoca concorrente, email non verificata, autorizzazioni dell’autore revocate e rollback atomico.


## Accessi dei membri ai progetti

Nel dettaglio del progetto, **Gestisci accessi** permette a OWNER e ADMIN dell’organizzazione di assegnare un MEMBER attivo, cambiarne il ruolo o revocarne l’accesso. I ruoli disponibili sono `MANAGER`, `EDITOR`, `OPERATOR` e `VIEWER`, con i permessi della policy esistente. Il ruolo progetto MANAGER non autorizza a gestire le assegnazioni. OWNER e ADMIN hanno accesso implicito a tutti i progetti: questo flusso non può limitarlo né modificarne il ruolo nell’organizzazione.

| Metodo | Percorso | Comportamento |
|---|---|---|
| GET | `/api/organizations/{org}/projects/{project}/members` | Elenca assegnazioni, ruoli e stati; solo OWNER/ADMIN |
| PUT | `/api/organizations/{org}/projects/{project}/members/{user}` | Assegna o riattiva un membro con JSON `{"role":"EDITOR"}`; restituisce 200 |
| DELETE | `/api/organizations/{org}/projects/{project}/members/{user}` | Revoca l’assegnazione; restituisce 204 ed è idempotente |

Il backend verifica ruoli e stato nel database, con RLS e controlli sul progetto dell’organizzazione indicata. Un ruolo non valido produce `400`, un membro senza privilegi amministrativi `403`, risorse non accessibili o appartenenti ad altre organizzazioni `404`, un destinatario non idoneo `409`. Assegnare richiede account e membership organizzazione attivi; revocare è consentito anche se il destinatario è sospeso. Le risposte con dati dei membri usano `Cache-Control: no-store`.

La revoca sospende la membership progetto e cancella entrambi i tipi di grant espliciti del destinatario in quel progetto. Anche cambio di ruolo e riattivazione cancellano i grant precedenti, evitando di ripristinare privilegi inattesi. Ripetere un PUT con lo stesso ruolo già attivo conserva invece i grant correnti. Le operazioni sono atomiche e non modificano gli altri progetti o la membership nell’organizzazione. Non servono nuove migrazioni, dipendenze o servizi.

Le prove PostgreSQL coprono autorizzazioni, isolamento, account sospesi, idempotenza, pulizia dei grant, rollback e richieste concorrenti. La console aggiunge otto test browser e una prova separata con due account, Keycloak e API reali: accettazione dell’invito, assegnazione, lettura del progetto, cambio di ruolo e revoca con successiva risposta 404. I dati temporanei della prova sono stati eliminati.


## Modifica e archiviazione dei progetti

Nel dettaglio, OWNER e ADMIN possono usare **Modifica progetto** per aggiornare nome e descrizione. Nome (1–160 caratteri) e descrizione (massimo 2000 caratteri) vengono ripuliti dagli spazi alle estremità; una descrizione vuota diventa null. Lo slug rimane invariato. I ruoli progetto, incluso MANAGER, non autorizzano queste operazioni amministrative.

| Metodo | Percorso | Comportamento |
|---|---|---|
| PUT | `/api/organizations/{org}/projects/{project}` | JSON `{"name":"Nuovo nome","description":"Descrizione facoltativa"}`; restituisce il progetto aggiornato con 200 |
| POST | `/api/organizations/{org}/projects/{project}/archive` | Senza payload; imposta ARCHIVED e restituisce 204, anche se già archiviato |

**Archivia progetto** richiede una conferma nella console. I dati e le assegnazioni restano nel database; il progetto scompare dall’elenco e il dettaglio restituisce 404, anche per OWNER/ADMIN. La policy nega l’accesso anche ai membri già assegnati. OWNER/ADMIN possono consultare gli archivi e ripristinarli dalla sezione dedicata; la cancellazione definitiva non è inclusa e lo slug resta riservato. Una modifica successiva all’archiviazione restituisce 404 e non può riattivare il progetto.

Il backend verifica account, membership e organizzazione attivi, ruolo amministrativo e appartenenza del progetto al tenant. Input non validi producono 400; un MEMBER attivo senza privilegi amministrativi riceve 403; risorse mancanti, inattive o di altre organizzazioni producono 404. Le operazioni sono transazionali, con RLS e lock coerenti con la gestione degli accessi. Modifiche concorrenti ai metadati seguono l’ordine di esecuzione: l’ultima modifica riuscita prevale. Non servono nuove migrazioni, dipendenze o servizi.

Sette prove PostgreSQL aggiuntive verificano normalizzazione e slug stabile, permessi, isolamento, attori inattivi, conservazione dei dati, revoca dell’accesso tramite archiviazione, idempotenza, rollback e concorrenza. Un test unitario aggiuntivo verifica la validazione prima dell’accesso al database. La console aggiunge otto prove browser con API simulate; una verifica separata con Keycloak, API e database reali controlla modifica persistente dopo reload, archiviazione, isolamento e risposte 400/401/404.


## Ruoli, sospensione e riattivazione dei membri

In **Membri e inviti**, un OWNER può cambiare il ruolo di un membro attivo tra MEMBER, ADMIN e OWNER e sospendere o riattivare altri membri. Un ADMIN può soltanto sospendere o riattivare MEMBER. I MEMBER non amministrano il team. Il backend verifica ogni operazione nel database: i ruoli mostrati dalla console o contenuti nel JWT non assegnano autorizzazioni.

| Metodo | Percorso | Payload e risultato |
|---|---|---|
| PUT | `/api/organizations/{org}/members/{user}/role` | `{"role":"ADMIN"}`; solo OWNER; restituisce il membro aggiornato con 200 e no-store |
| PUT | `/api/organizations/{org}/members/{user}/status` | `{"status":"SUSPENDED"}` oppure `{"status":"ACTIVE"}`; restituisce il membro aggiornato con 200 e no-store |

Ruolo e stato hanno endpoint distinti, così un cambio di ruolo non riattiva una membership sospesa. Cambiare ruolo richiede membership e account attivi. La riattivazione richiede un account globale attivo e non può riabilitare un account disabilitato. Nessuno può sospendere sé stesso. Un OWNER può ridurre il proprio ruolo soltanto dopo aver nominato un altro OWNER attivo con account attivo: il lock dell’organizzazione serializza richieste concorrenti, mentre il vincolo PostgreSQL resta attivo come ulteriore protezione. Input non validi producono 400, permessi insufficienti 403, risorse fuori tenant o non accessibili 404 e operazioni incompatibili con questi vincoli 409.

Un effettivo cambio di ruolo o una sospensione cancella i grant espliciti dell’utente nell’organizzazione e nei suoi progetti, sospende le assegnazioni ai progetti e revoca gli inviti pendenti emessi dalla persona. La pulizia e la modifica della membership sono atomiche e limitate all’organizzazione indicata. Ripetere ruolo o stato già correnti è idempotente e conserva eventuali nuovi permessi; riattivare non ripristina grant, assegnazioni o inviti revocati. OWNER/ADMIN attivi mantengono l’accesso implicito a tutti i progetti previsto dalla policy. Le altre organizzazioni e l’account/sessione Keycloak restano indipendenti.

La console richiede conferma e mostra gli effetti prima dell’invio. Dopo il successo rilegge team e accessi; dopo un cambio del proprio ruolo ricarica l’organizzazione e rimuove i vecchi controlli. Un membro riattivato può riaprire il link della stessa organizzazione dopo un precedente rifiuto d’accesso. Non sono incluse cancellazione dei membri o modifica del profilo personale. Non servono migrazioni, servizi o dipendenze aggiuntive.

Tredici prove PostgreSQL aggiuntive coprono matrice dei ruoli, tenant, account inattivi, ultimo OWNER utilizzabile, sospensione, idempotenza, pulizia dei tre tipi di grant, revoca degli inviti, rollback e concorrenza tra OWNER. Un test unitario aggiuntivo verifica ruoli/stati invalidi prima del database. Undici test browser usano API simulate per coprire conferme, doppi invii, permessi, conflitti, retry, cambio del proprio ruolo, account inattivi, scadenza della sessione e rientro dopo riattivazione; una prova separata usa due account reali con Keycloak e PostgreSQL. I dati temporanei vengono ripuliti.


## Elenco e ripristino dei progetti archiviati

Nella sezione **Progetti archiviati**, OWNER e ADMIN possono consultare nome, indirizzo e descrizione dei progetti archiviati. L’elenco viene caricato soltanto all’apertura. Questi metadati non consentono di modificare il progetto o gestirne i membri finché rimane archiviato. Un MEMBER, anche MANAGER del progetto, non può consultare l’archivio né ripristinarlo.

| Metodo | Percorso | Comportamento |
|---|---|---|
| GET | `/api/organizations/{org}/projects/archived` | Elenco dei soli ARCHIVED, ordinati per ultimo aggiornamento e ID; solo OWNER/ADMIN |
| POST | `/api/organizations/{org}/projects/{project}/restore` | Senza payload; imposta ACTIVE e restituisce il progetto con 200; idempotente se già attivo |

**Ripristina progetto** richiede conferma. Il ripristino conserva ID, slug, nome e descrizione e riapre il progetto con le assegnazioni e i grant ancora validi. Non riattiva membership sospese, account o organizzazioni inattive e non ricrea grant cancellati. In particolare, i cambi ruolo e le sospensioni organizzative eseguiti durante l’archiviazione continuano a revocare gli accessi secondo le regole del team. Un membro ancora attivo e assegnato ritrova invece l’accesso previsto dalla policy dopo il ripristino.

Le verifiche amministrative usano ruoli correnti nel database. La query dell’elenco ripete il controllo di ruolo e stati nella lettura finale; il ripristino usa lo stesso lock dell’organizzazione delle altre mutazioni, con RLS e transazione atomica. Un MEMBER riceve 403; organizzazioni/account/membership non accessibili e progetti mancanti o fuori tenant producono 404; richieste anonime ricevono 401. Entrambe le nuove risposte usano `Cache-Control: no-store`. Il dettaglio ordinario di un ARCHIVED continua a restituire 404 fino al ripristino. Richieste concorrenti di archiviazione e ripristino vengono serializzate; l’ultima operazione eseguita determina lo stato finale. Non servono migrazioni, dipendenze o servizi aggiuntivi.

Dieci nuove prove PostgreSQL verificano elenco separato, permessi OWNER/ADMIN, isolamento, inattività, identità dei dati, idempotenza, mantenimento dei grant validi, revoche e cambi ruolo durante l’archiviazione, rollback e concorrenza. Dieci nuovi test browser simulano le API per verificare caricamento su richiesta, conferme, annullamento, invio singolo, dati aggiornati, ruoli, errori, sessione scaduta e risposte tardive dopo navigazione. Una prova separata con due account, Keycloak e PostgreSQL reali verifica il ripristino con accessi validi e il mancato recupero dei diritti revocati durante l’archiviazione, oltre ai layout desktop/mobile. I dati temporanei sono stati eliminati.


## Assistenti in bozza

Nel dettaglio di un progetto attivo, **Assistenti** carica l’elenco e permette di creare, leggere e modificare configurazioni reali salvate in PostgreSQL. Questa funzionalità prepara le bozze; pubblicazione, esecuzione in chat, collegamento a provider AI e ingestione delle fonti non sono ancora inclusi. La console indica esplicitamente che una bozza non è pubblicata e non risponde in chat.

Il nome richiede 1–160 caratteri e le istruzioni 1–12000 caratteri dopo la pulizia degli spazi alle estremità. Il messaggio iniziale è facoltativo, con massimo 1000 caratteri prima della pulizia; un valore vuoto diventa null. Il server genera ID e `public_id` e imposta sempre stato DRAFT e `draftLockVersion=0`. Il payload non espone tenant, stato, versioni pubblicate o grant. I nomi possono ripetersi: gli assistenti si identificano tramite UUID.

| Metodo | Percorso | Comportamento |
|---|---|---|
| GET | `/api/organizations/{org}/projects/{project}/assistants` | Restituisce `{canEdit, items}` con riepiloghi e capacità effettiva di creazione |
| POST | `/api/organizations/{org}/projects/{project}/assistants` | JSON `{name, instructions, welcomeMessage}`; crea DRAFT, restituisce 201, Location e dettaglio |
| GET | `/api/organizations/{org}/projects/{project}/assistants/{assistant}` | Dettaglio con istruzioni, messaggio iniziale, versione e `canEdit` |
| PUT | `/api/organizations/{org}/projects/{project}/assistants/{assistant}` | JSON `{name, instructions, welcomeMessage, expectedVersion}`; aggiorna una DRAFT e incrementa la versione, restituisce 200 |

Tutti i membri attivi assegnati al progetto possono consultare le bozze. La policy esistente `EDIT_CONFIGURATION` abilita scrittura per OWNER/ADMIN dell’organizzazione e MANAGER/EDITOR del progetto; OPERATOR e VIEWER hanno sola lettura. Un grant `ASSISTANT_PUBLISH` non concede permessi di modifica. Le capacità restituite governano i controlli della console, mentre il backend verifica ogni richiesta. Eventuali assistenti PUBLISHED o SUSPENDED già presenti sono leggibili e non modificabili da questa schermata.

Le letture ricontrollano l’accesso nella query finale; le scritture bloccano l’organizzazione prima di verificare progetto, account e membership, secondo l’ordine già usato dagli altri servizi. RLS e tutti gli identificativi del percorso delimitano le query. Input invalidi producono 400, scrittura senza privilegi 403, risorse mancanti/fuori tenant o accessi inattivi 404. Le nuove risposte usano `Cache-Control: no-store`. Progetti archiviati non espongono assistenti finché non vengono ripristinati.

La versione attesa appartiene al testo aperto in modifica. Il salvataggio condizionato sulla versione evita sovrascritture concorrenti; una versione superata o uno stato non più DRAFT produce 409 senza alterare i dati. La console conserva i campi e offre **Ricarica e scarta modifiche** per rileggere esplicitamente la versione corrente. Anche chiudere e riaprire il pannello non sostituisce la versione associata al testo locale. L’aggiornamento modifica soltanto nome e le chiavi `instructions`/`welcomeMessage` di `draft_config`, preservando le altre configurazioni.

La creazione non viene ripetuta automaticamente dopo un esito ambiguo: aggiornare l’elenco prima di riprovare, poiché la bozza potrebbe già esistere. La selezione dell’assistente resta nella pagina corrente; al reload si riapre il progetto e si può selezionare nuovamente l’assistente. Non sono inclusi cancellazione, pubblicazione o sospensione degli assistenti. Non servono migrazioni, dipendenze, credenziali AI o servizi aggiuntivi.

Dodici nuove prove PostgreSQL coprono ruoli/capacità, isolamento, revoche e stati inattivi, grant, normalizzazione, dati gestiti dal server, configurazioni preservate, conflitti, rollback e salvataggi concorrenti. Due test unitari verificano la validazione prima del database. Tredici test browser con API simulate coprono caricamento su richiesta, creazione e modifica senza doppi invii, capability, conflitti e rientro nel pannello, validazione, errori, sessione scaduta e recupero dopo esiti ambigui. Una prova separata con due account e servizi reali verifica persistenza, modifiche concorrenti, sola lettura dopo cambio ruolo e revoca, oltre al layout desktop/mobile. Tutte le fixture temporanee sono state eliminate.
