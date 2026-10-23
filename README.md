# Annotino

Annotino è un'applicazione web per trascrivere ed etichettare il parlato in gruppo.
Ogni linguista può aprire un team, caricare registrazioni e annotarle con i colleghi
come in Praat, discuterne e misurare l'accordo tra annotatori. Registrazioni e annotazioni
sono cifrate end-to-end: chi ospita i dati, compreso chi sviluppa Annotino, non può
ascoltarle né leggerle.

Annotino è una pagina statica. I dati di ogni team stanno, cifrati, dove il team sceglie:

| Modalità | Dove stanno i dati | Costo | Per chi |
| --- | --- | --- | --- |
| **GitHub** (consigliata) | in un repository privato di chi crea il team | gratuito | gruppi di ricerca |
| **Server Annotino** | in un progetto Supabase nell'UE, se lo configuri | piano gratuito di Supabase | chi preferisce un server unico |
| **Solo questo browser** | in IndexedDB su questo computer | gratuito | prove, didattica, lavoro offline |

## Funzioni

- **Team e ruoli.** Proprietario, amministratori (caricano audio e invitano), membri (annotano).
- **Analisi acustica** calcolata nel browser: spettrogramma (banda larga o stretta),
  pitch (autocorrelazione, Boersma 1993), formanti (LPC di Burg), intensità e curva di
  velocità d'eloquio con i nuclei sillabici (de Jong & Wempe 2009).
- **Tier a intervalli e a punti**, uno o più per annotatore, con tutti i simboli IPA ed extIPA
  (tastiera integrata, ricerca per nome, font Charis SIL incluso).
- **Disegni e testo sullo spettrogramma** (cerchio, riquadro, freccia, penna, testo) con note,
  ancorati in tempo e frequenza; si eliminano dalla × sullo spettrogramma. La vista si esporta come PNG.
- **Ascolto al clic**: cliccando un intervallo lo si sente (disattivabile nelle impostazioni di analisi).
- **Tag** su intervalli, punti, tratti e parti dello spettrogramma, con un vocabolario comune
  (per esempio *da discutere*, *incerto*, *esempio*). Si filtra per tag, si ascoltano in sequenza
  solo le parti con quei tag e si può attenuare tutto il resto della timeline.
- **Discussioni** ancorate a un tratto, un intervallo, un punto o un disegno, con menzioni `@Nome`.
  Le discussioni aperte segnano le zone da discutere e compaiono in una corsia della timeline.
- **Notifiche** per menzioni e risposte, con salto diretto al punto della registrazione.
- **Regole di annotazione** condivise dal team: un documento con titoli, elenchi e riferimenti
  a parti delle registrazioni che si ascoltano direttamente dal documento («Cita nelle regole»
  dall'editor), più la definizione dei tag con i loro esempi.
- **Cronologia** di ogni tier e delle regole, con anteprima e ripristino (su GitHub viene dai commit).
- **Visibilità per tier:** solo io, tutto il team, team da una data, oppure *cieco*
  finché un amministratore non lo rivela. Il proprietario può fissare una visibilità per tutto il team.
- **Accordo tra annotatori**, con misure diverse per ciò che si confronta:
  - confini (tier a intervalli): precision, recall, F1 con tolleranza, scarto medio in ms;
  - etichette nel tempo: α di Krippendorff su frame, κ di Cohen e κ pesato per coppia, κ di Fleiss;
  - segmenti: abbinamento per sovrapposizione (IoU) e accordo sulle etichette abbinate;
  - tier a punti: abbinamento con tolleranza, F1, scarto temporale, accordo sulle etichette.

  Le etichette si possono confrontare come categorie esatte o per **somiglianza fonetica**:
  una distanza basata sui tratti articolatori (luogo, modo, sonorità; altezza, anteriorità,
  arrotondamento) e sui diacritici, per cui [e̞] contro [e̝] costa poco e [e] contro [p] costa il massimo.
  Una striscia sotto i tier mostra dove gli annotatori non concordano.
- **Praat**: importazione ed esportazione TextGrid; esportazione CSV delle misure acustiche
  e delle misure per intervallo.
- Interfaccia in italiano e inglese.

## Come sono protetti i dati

| Cosa | Dove | In che forma |
| --- | --- | --- |
| Audio, nomi dei file, nomi dei team, tier, disegni | server | cifrati con AES-256-GCM con la chiave del team |
| Chiave del team | server | una copia per membro, cifrata con la sua chiave pubblica RSA-OAEP 3072 |
| Chiave privata dell'utente | server | cifrata con una chiave derivata dalla password (PBKDF2, 600 000 iterazioni) e, separatamente, dal codice di recupero |
| Password | mai inviata | al server arriva solo un valore derivato (PBKDF2 con sale legato all'email) |
| Email, nome visualizzato, ruoli, orari e dimensioni dei caricamenti | server | in chiaro: servono per l'accesso e i permessi |

Con il server Supabase la visibilità è applicata dalle *row-level security policy*
di Postgres (`supabase/schema.sql`): un tier cieco o privato non viene mai inviato agli altri
membri finché non è rivelato.

Su GitHub ogni collaboratore può scaricare tutto il repository, quindi la visibilità è
garantita dalla crittografia: i tier privati, ciechi o programmati sono **sigillati** con una
chiave che ha solo l'autore. Il sigillo viene tolto dal browser dell'autore quando il tier può
essere mostrato (data raggiunta, tier ciechi rivelati da un amministratore, oppure l'autore lo
condivide), **la volta successiva che l'autore apre Annotino**. Fino ad allora i colleghi non lo vedono.

La build di produzione include una Content-Security-Policy che permette al codice di parlare
solo con il proprio dominio, con Supabase e con l'API di GitHub.

Limiti da conoscere:

- Se un utente dimentica password **e** codice di recupero, i suoi dati non sono recuperabili.
  È il prezzo della cifratura end-to-end.
- Chi viene rimosso da un team conserva la chiave del team che aveva già ricevuto; un
  ex membro con accesso al database potrebbe quindi decifrare i dati caricati prima della rimozione.
  La rotazione della chiave è un possibile sviluppo futuro.
- Chi distribuisce il codice dell'applicazione potrebbe, in teoria, distribuire una versione
  modificata. Per questo il codice è pubblico e la build avviene su GitHub Actions a partire dal repository.
- Il proprietario di un team vede gli indirizzi email dei membri; ogni utente registrato
  può verificare se un'email ha un account (serve per gli inviti).
- Le discussioni, le regole e i tag condivisi sono leggibili da tutto il team. Quando si apre una
  discussione su un tier non ancora condiviso, Annotino non ne copia l'etichetta.

Limiti specifici di GitHub:

- **Accesso.** Con il pulsante «Continua con GitHub» (GitHub App più ponte, vedi
  [`bridge/README.md`](bridge/README.md)) Annotino può toccare solo le repository dove è
  installato e i token scadono dopo 8 ore. Il ponte vede per un attimo il token durante lo
  scambio, mai i dati. In alternativa si può incollare un token *classic* con i permessi `repo` e
  `gist`, che però dà accesso a tutte le repository dell'utente.
- **Metadati.** GitHub e i collaboratori vedono nomi dei file, dimensioni e orari dei commit;
  il contenuto resta cifrato. GitHub non è un fornitore UE: valuta con il tuo ateneo se i dati
  cifrati possono stare lì.
- **Limiti di spazio.** GitHub consiglia repository sotto 1 GB e accetta file fino a 100 MB
  (Annotino si ferma a 50 MB per file).
- **Chiave pubblica.** Al primo accesso Annotino pubblica un gist con la tua chiave pubblica,
  così gli amministratori possono aggiungerti per nome utente, e salva in un gist segreto la tua
  chiave privata cifrata con la password e l'elenco dei tuoi team.

## Provarlo subito, senza server

```bash
npm install
npm run dev
```

Nella pagina di accesso scegli **Solo questo browser**: account e dati restano in IndexedDB,
con la stessa cifratura e le stesse regole di visibilità. Si possono creare più account sullo
stesso computer per provare annotazione cieca, discussioni, notifiche e accordo.
Nel team, «Aggiungi una registrazione di prova» carica un /anːoˈtiːno/ sintetizzato.

## Pubblicarlo gratis

### L'app, su GitHub Pages

1. Pubblica il repository su GitHub.
2. In *Settings → Pages* scegli *Source: GitHub Actions*.
3. Ogni push su `main` esegue i test, compila e pubblica (`.github/workflows/deploy.yml`).

Basta questo per la modalità GitHub con token incollato. Per il pulsante «Continua con GitHub»
servono anche una GitHub App e il ponte su Cloudflare: i passaggi sono in
[`bridge/README.md`](bridge/README.md).

### Come lo usano i team (modalità GitHub)

1. Chi crea il team clicca «Continua con GitHub» (o incolla un token) e sceglie una password di
   Annotino. Riceve un codice di recupero.
2. Installa Annotino sul proprio account GitHub (la pagina lo propone), poi «Nuovo team» crea un
   repository privato `annotino-team-…` nel suo account.
3. Ogni collega accede una volta ad Annotino con il proprio GitHub. Poi l'amministratore lo
   aggiunge per nome utente GitHub: diventa collaboratore del repository e riceve la chiave del team.
4. Il collega, al successivo accesso, vede l'invito e clicca «Entra nel team».

Se il team usa un'organizzazione GitHub, il repository può stare lì; i membri lo aprono con
«Apri un team dal suo repository».

### Facoltativo: server Supabase

Se preferisci un server unico, nell'UE, Annotino può usare anche Supabase.

#### 1. Supabase (database e file, nell'UE)

1. Crea un progetto su [supabase.com](https://supabase.com) scegliendo la regione
   **Central EU (Frankfurt)**.
2. In *SQL Editor* esegui tutto `supabase/schema.sql`. Crea tabelle, policy e il bucket privato `audio`.
3. In *Authentication → URL Configuration* imposta come *Site URL* l'indirizzo dove pubblicherai l'app
   (per esempio `https://<utente>.github.io/annotino/`) e aggiungilo ai *Redirect URLs*.
4. In *Authentication → Providers → Email* lascia attiva la conferma dell'email. Il servizio email
   incluso ha limiti bassi (poche email all'ora): per un uso reale configura un SMTP in
   *Authentication → SMTP Settings* (per esempio Brevo o Resend hanno piani gratuiti).
5. In *Project Settings → API* copia *Project URL* e la chiave *anon public*.
   La chiave anon è pubblica per progetto: la sicurezza viene dalle policy e dalla cifratura.

Limiti indicativi del piano gratuito (verificali su supabase.com/pricing): 500 MB di database, 1 GB di file, 50 MB per file.
Un'ora di audio mono a 16 kHz in WAV occupa circa 115 MB, in FLAC circa la metà.
**Un progetto gratuito viene messo in pausa dopo una settimana senza attività**: si riattiva dal
pannello. Per un gruppo di ricerca stabile conviene il piano Pro o un'istanza Supabase self-hosted
su un server universitario (lo schema è lo stesso).

#### 2. Collegare l'app

In *Settings → Secrets and variables → Actions* del repository dell'app aggiungi
`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`: alla build successiva compare la scelta
«Server Annotino» nella pagina di accesso.

In alternativa Cloudflare Pages: comando di build `npm run build`, cartella `dist`, stesse
variabili d'ambiente; il file `public/_headers` aggiunge intestazioni di sicurezza.

Per lavorare in locale contro Supabase copia `.env.example` in `.env.local` e compila le due variabili.

## Sviluppo

```bash
npm test          # metriche di accordo, distanza fonetica, DSP, TextGrid
npm run typecheck
npm run build
```

| Cartella | Contenuto |
| --- | --- |
| `src/crypto` | derivazione delle chiavi, cifratura, chiavi utente e di team |
| `src/backend` | interfaccia dati: GitHub, Supabase, modalità locale (IndexedDB) |
| `src/dsp` | FFT, spettrogramma, pitch, formanti, intensità, velocità d'eloquio, worker, sintetizzatore |
| `src/ipa` | simboli IPA/extIPA e distanza fonetica |
| `src/agreement` | Krippendorff, Cohen, Fleiss, abbinamento di confini, segmenti e punti |
| `src/components` | interfaccia; `editor/` contiene timeline, pannelli (tier, tag, discussioni, accordo) e tastiera IPA |
| `src/lib/references.ts` | riferimenti `annotino://` e Markdown ridotto delle regole |
| `supabase/schema.sql` | schema, policy di accesso, bucket |

I valori acustici seguono gli algoritmi di Praat ma non sono identici: prima di pubblicare
dati conviene confrontarli con Praat sulle stesse impostazioni.

## Licenze

Il font Charis SIL è distribuito con la SIL Open Font License (`src/assets/fonts/CharisSIL-OFL.txt`).
