# Notes: Browser Testing Architecture Research

## Implementazione LaunchDarkly (Reference)

File scaricati da: `https://github.com/launchdarkly/js-core/tree/main/packages/sdk/browser/contract-tests`
Licenza: Apache 2.0 (compatibile uso commerciale)

### Architettura Esatta

```
┌─────────────────┐     HTTP      ┌─────────────────┐    WebSocket    ┌─────────────────┐
│  Test Harness   │ ──────────►  │     Adapter     │ ◄─────────────► │     Entity      │
│     (Go)        │  :8000       │   (Node.js)     │    :8001        │  (Vite + SDK)   │
│                 │              │   Express + ws  │                 │  :5173          │
└─────────────────┘              └─────────────────┘                 └─────────────────┘
```

### Porte Usate

| Servizio          | Porta | Protocollo |
| ----------------- | ----- | ---------- |
| Adapter REST      | 8000  | HTTP/REST  |
| Adapter WebSocket | 8001  | WebSocket  |
| Entity (Vite dev) | 5173  | HTTP       |

### Flusso Comandi

1. **Test Harness → Adapter (REST)**
   - `GET /` → getCapabilities
   - `POST /` → createClient (ritorna Location header con `/clients/{id}`)
   - `POST /clients/:id` → runCommand
   - `DELETE /clients/:id` → deleteClient
   - `DELETE /` → shutdown

2. **Adapter → Entity (WebSocket)**
   - Ogni richiesta REST viene tradotta in messaggio JSON con `reqId`
   - Entity risponde con stesso `reqId` per correlazione
   - Adapter usa pattern Promise-based con `waiters` map

3. **Entity → SDK**
   - Entity mantiene map di `ClientEntity` (uno per client creato)
   - Ogni ClientEntity wrappa un'istanza dell'SDK reale
   - Comandi: evaluate, evaluateAll, identifyEvent, customEvent, flushEvents

### Struttura File LaunchDarkly

```
contract-tests/
├── adapter/
│   ├── package.json         # express, cors, body-parser, ws
│   └── src/index.ts         # ~110 LOC
│
├── entity/
│   ├── package.json         # @launchdarkly/js-client-sdk, vite, playwright
│   ├── index.html           # Minimal HTML con <script type="module">
│   └── src/
│       ├── main.ts          # Entry: crea TestHarnessWebSocket
│       ├── TestHarnessWebSocket.ts  # Gestisce connessione WS e routing comandi
│       ├── ClientEntity.ts  # Wrappa SDK client
│       ├── CommandParams.ts # Tipi per comandi
│       └── ConfigParams.ts  # Tipi per configurazione
│
└── run-test-service.sh      # Avvia entrambi i servizi
```

### Dettagli Implementativi

**Adapter (index.ts)**:

- WebSocket server su 8001, attende connessione browser
- Quando browser si connette, crea Express server su 8000
- Ogni richiesta REST: genera `reqId`, invia via WS, attende risposta, ritorna HTTP
- Pattern request/response con Promise e `waiters` map

**Entity (TestHarnessWebSocket.ts)**:

- Si connette a ws://localhost:8001
- Mantiene `_entities: Record<string, ClientEntity>`
- Comandi:
  - `getCapabilities` → ritorna array di capabilities
  - `createClient` → crea ClientEntity, assegna ID incrementale
  - `runCommand` → delega a ClientEntity.doCommand()
  - `deleteClient` → chiude e rimuove entity

**Entity (ClientEntity.ts)**:

- Wrappa istanza SDK (`LDClient`)
- `doCommand()` esegue operazioni sull'SDK:
  - `evaluate` → variation/variationDetail
  - `evaluateAll` → allFlags()
  - `identifyEvent` → identify()
  - `customEvent` → track()
  - `flushEvents` → flush()

### Differenze da Adattare per Rollgate

| LaunchDarkly                            | Rollgate                                          | Note                               |
| --------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| `credential`                            | `apiKey`                                          | Nome diverso                       |
| `LDClient`                              | `RollgateClient`                                  | Classe diversa                     |
| `createClient(envId, context, config)`  | `new RollgateClient(config).init(user)`           | Pattern init diverso               |
| `boolVariation`, `stringVariation`, etc | `isEnabled`, (getString, getNumber da aggiungere) | API diversa                        |
| Capabilities system                     | Non necessario per ora                            | Rollgate test harness più semplice |

### Piano Implementazione

1. **Adapter** - Copiare quasi identico, cambiare solo nomi/logging
2. **Entity structure** - Stessa struttura Vite + WebSocket
3. **ClientEntity** - Adattare per API Rollgate (isEnabled vs variation)
4. **CommandParams** - Semplificare per comandi Rollgate esistenti

### File di Reference Locali

```
C:\Projects\rollgate-sdks\test-harness\browser-testing\reference\
├── adapter-index.ts
├── adapter-package.json
├── TestHarnessWebSocket.ts
├── ClientEntity.ts
├── CommandParams.ts
├── ConfigParams.ts
├── entity-main.ts
├── entity-index.html
├── entity-package.json
└── run-test-service.sh
```
