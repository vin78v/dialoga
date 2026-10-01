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

Il test rapido usa Docker Compose e non richiede installare JDK o Maven sul PC. Il container compila con JDK 21 e lancia `mvn verify` durante la build. Se preferisci eseguire l’app fuori da Docker, servono JDK 21, Maven 3.6.3+ e PostgreSQL 16. Gli script inclusi vanno applicati con un utente di migrazione: V1, V3 e V4, in quest’ordine. V2 resta opzionale e serve solo per pgvector. Il realm Keycloak deve emettere token con `iss` corrispondente a `DIALOGA_OIDC_ISSUER` e `aud` contenente `DIALOGA_API_AUDIENCE` (default `dialoga-api`).

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

Questo è un nucleo di sicurezza, non l'applicazione SaaS completa. Non crea ancora automaticamente organizzazione e membership OWNER: quello sarà il flusso di onboarding successivo. I test inclusi verificano la matrice di autorizzazione a livello unitario; non sono ancora test d’integrazione del database/JWT. Il codice non è stato eseguito contro un Keycloak reale né compilato in questo ambiente, che al momento dispone solo di Java 17 e non ha Maven. Eseguire `mvn test` con JDK 21 e Maven prima di integrare in un repository. Non pubblicare il servizio finché issuer, audience, CORS, database runtime e realm non sono configurati per l'ambiente previsto.

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
