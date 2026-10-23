# «Continua con GitHub»: GitHub App e ponte su Cloudflare

Il pulsante «Continua con GitHub» richiede due cose, entrambe gratuite, da fare **una volta sola**
per tutta l'installazione di Annotino (non per ogni team):

1. una **GitHub App** chiamata Annotino, che chiede a ogni utente il permesso di creare e usare
   le repository dei suoi team;
2. il **ponte** (`worker.js`), un piccolo programma su Cloudflare Workers. GitHub consegna il token
   d'accesso solo in cambio del segreto dell'app, che non può stare in una pagina web pubblica:
   il ponte fa questo scambio e nient'altro. Non salva e non registra niente, e non vede mai
   audio o annotazioni, che vanno dal browser a GitHub già cifrati.

Sotto, `TUONOME` è il tuo nome utente GitHub e `https://TUONOME.github.io/Annotino/` l'indirizzo
dove è pubblicato Annotino. Mettilo esattamente come appare nel browser, con la `/` finale.

## 1. Creare la GitHub App

GitHub → foto profilo → *Settings* → *Developer settings* → *GitHub Apps* → **New GitHub App**.

| Campo | Valore |
|---|---|
| GitHub App name | `Annotino` (se è già preso: `Annotino TUONOME`) |
| Homepage URL | `https://TUONOME.github.io/Annotino/` |
| Callback URL | `https://TUONOME.github.io/Annotino/` e, con *Add Callback URL*, `http://localhost:5173/` per provarlo in locale |
| Expire user authorization tokens | ✔ attivo |
| Request user authorization (OAuth) during installation | ✘ disattivo |
| Enable Device Flow | ✘ disattivo |
| Setup URL | `https://TUONOME.github.io/Annotino/` |
| Redirect on update | ✔ attivo |
| Webhook → Active | ✘ disattivo |

**Permessi**, solo questi:

- *Repository permissions*:
  - **Administration: Read and write**, per creare la repo del team e aggiungere i colleghi;
  - **Contents: Read and write**, per audio, annotazioni e cronologia;
  - *Metadata: Read-only* si attiva da solo.
- *Account permissions*:
  - **Gists: Read and write**, per la chiave pubblica e la chiave privata cifrata.

*Where can this GitHub App be installed?* → **Any account**.

Dopo *Create GitHub App* annota:

- il **Client ID** (inizia con `Iv`);
- lo **slug**, cioè l'ultima parte dell'indirizzo della pagina dell'app, per esempio
  `annotino` in `github.com/apps/annotino`;
- un **client secret**: *Generate a new client secret*. Copialo subito, GitHub lo mostra una
  volta sola, e non metterlo mai nel codice né nel repository.

## 2. Pubblicare il ponte su Cloudflare

1. Crea un account gratuito su <https://dash.cloudflare.com/sign-up>.
2. Nel terminale, dalla cartella di Annotino:

   ```bash
   cd bridge
   npx wrangler login
   ```

3. In `wrangler.toml`, in `ALLOWED_ORIGINS` sostituisci `TUONOME` con il tuo nome utente:
   `https://TUONOME.github.io,http://localhost:5173`. Va messa solo l'origine: niente
   `/Annotino/` e niente `/` finale.
4. Inserisci ID e segreto: ognuno dei due comandi chiede di incollare il valore.

   ```bash
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler deploy
   ```

5. `deploy` stampa l'indirizzo del ponte, per esempio
   `https://annotino-bridge.TUONOME.workers.dev`.

Il piano gratuito di Workers copre 100.000 richieste al giorno. Annotino ne usa una all'accesso
e una ogni 8 ore di lavoro.

## 3. Collegare Annotino

Sul repository di Annotino: *Settings* → *Secrets and variables* → *Actions* → scheda
**Variables** → *New repository variable*, tre volte:

| Nome | Valore |
|---|---|
| `VITE_GITHUB_CLIENT_ID` | il Client ID |
| `VITE_GITHUB_APP_SLUG` | lo slug |
| `VITE_GITHUB_BRIDGE` | l'indirizzo del ponte |

Poi *Actions* → *Deploy to GitHub Pages* → *Run workflow*.

Per provarlo in locale, metti gli stessi tre valori in un file `.env.local` (vedi
`.env.example`) e avvia `npm run dev`.

## Come funziona per gli utenti

- **Chi crea un team** clicca «Continua con GitHub», autorizza Annotino, sceglie la password di
  Annotino e poi, quando la pagina lo propone, installa Annotino sul proprio account. Nella
  pagina di installazione conviene scegliere *Only select repositories* e selezionare una
  repository qualsiasi. Le repository dei team che Annotino crea dopo si aggiungono da sole.
- **I colleghi** fanno solo «Continua con GitHub» e la password: non devono installare niente.
  Vedono le repo del team perché il proprietario li aggiunge come collaboratori.

## Sicurezza, in breve

- Il segreto dell'app sta solo nei *secrets* di Cloudflare.
- Il ponte risponde solo alle origini in `ALLOWED_ORIGINS`.
- Il codice di accesso è legato al browser con PKCE, e il token scade dopo 8 ore. Annotino lo
  rinnova con un *refresh token*, che vale 6 mesi e cambia a ogni rinnovo.
- Il ponte vede il token per l'istante dello scambio. Con quel token si arriva solo alle
  repository dove Annotino è installato, e il loro contenuto è cifrato, quindi non leggibile.
  Chiunque gestisca il ponte potrebbe però, in teoria, cancellare dei file: per questo il ponte
  deve gestirlo chi gestisce Annotino.
