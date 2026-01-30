# Task Plan: Browser Testing Architecture per SDK React

## Goal

Implementare browser testing per SDK React seguendo esattamente l'architettura LaunchDarkly.

## Reference

File LaunchDarkly scaricati in: `test-harness/browser-testing/reference/`
Fonte: https://github.com/launchdarkly/js-core/tree/main/packages/sdk/browser/contract-tests
Licenza: Apache 2.0 ✓

## Architettura (identica a LaunchDarkly)

```
┌─────────────────┐     HTTP      ┌─────────────────┐    WebSocket    ┌─────────────────┐
│  Test Harness   │ ──────────►  │     Adapter     │ ◄─────────────► │     Entity      │
│     (Go)        │  :8000       │   (Node.js)     │    :8001        │  (Vite + React) │
│                 │              │   Express + ws  │                 │  :5173          │
└─────────────────┘              └─────────────────┘                 └─────────────────┘
```

## Fasi

- [x] Fase 1: Ricerca e documentazione architettura LaunchDarkly
- [x] Fase 2: Download file reference LaunchDarkly
- [ ] Fase 3: Conferma piano con utente
- [ ] Fase 4: Implementazione adapter (copia quasi identica)
- [ ] Fase 5: Implementazione entity (browser app React)
- [ ] Fase 6: Integrazione con test harness Go esistente
- [ ] Fase 7: Test e validazione

## Struttura Target

```
test-harness/
├── browser-adapter/              # Adapter Node.js (porta 8000, 8001)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       └── index.ts              # Express + WebSocket bridge
│
├── browser-entity/               # Browser app (porta 5173)
│   ├── package.json              # vite, @rollgate/sdk-react
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx              # Entry point
│       ├── TestHarnessWebSocket.ts
│       ├── ClientEntity.ts       # Wrappa RollgateProvider/hooks
│       └── types.ts              # CommandParams, ConfigParams
│
└── browser-testing/              # (corrente) Piano e reference
    ├── task_plan.md
    ├── notes.md
    └── reference/                # File LaunchDarkly
```

## Mapping Comandi LaunchDarkly → Rollgate

| LaunchDarkly        | Rollgate      | Implementazione                     |
| ------------------- | ------------- | ----------------------------------- |
| `createClient`      | `init`        | Crea RollgateProvider + inizializza |
| `evaluate` (bool)   | `isEnabled`   | useFlag hook o client.isEnabled     |
| `evaluate` (string) | `getString`   | Da implementare in SDK              |
| `evaluate` (number) | `getNumber`   | Da implementare in SDK              |
| `evaluateAll`       | `getAllFlags` | getAllFlags esistente               |
| `identifyEvent`     | `identify`    | client.identify                     |
| `deleteClient`      | `close`       | client.close                        |

## Differenze Chiave

1. **Test Harness Protocol**: LaunchDarkly usa `/clients/:id` per gestire multiple istanze.
   Il nostro test harness usa `POST /` con `{ command: "..." }`.
   → **Decisione necessaria**: Adattare adapter per nostro protocollo o adattare test harness.

2. **SDK API**: Rollgate usa `isEnabled(key, default)`, LaunchDarkly usa `variation(key, default)`.
   → Adattare ClientEntity.

3. **React Integration**: LaunchDarkly testa SDK JS generico. Noi testiamo React hooks.
   → Entity deve montare RollgateProvider e usare hooks in componenti reali.

## Decisioni (seguire LaunchDarkly al 100%)

1. **Protocollo**: Adattare test harness Go per usare `/clients/:id` come LaunchDarkly
2. **SDK Architecture**: Creare `@rollgate/sdk-browser` (JS generico), `sdk-react` diventa wrapper
3. **Browser**: Playwright automatico (headless per CI)

Se il nostro sistema non si adatta, modifichiamo il nostro sistema.

## Fasi Aggiornate

- [x] Fase 1: Ricerca e documentazione architettura LaunchDarkly
- [x] Fase 2: Download file reference LaunchDarkly
- [x] Fase 3: Conferma piano con utente
- [x] Fase 4: Implementazione browser-adapter
- [x] Fase 5: Creare @rollgate/sdk-browser (SDK JS generico)
- [x] Fase 6: Implementazione browser-entity
- [x] Fase 7: Integrazione con test harness Go (BrowserTestService + SDKService interface)
- [x] Fase 8: Test E2E manuale - COMPLETATO
- [ ] Fase 9: Integrazione CI (script automatico + GitHub Actions)
- [x] Fase 10: Refactor sdk-react per usare sdk-browser - COMPLETATO
- [x] Fase 11: Refactor sdk-vue per usare sdk-browser - COMPLETATO
- [x] Fase 12: Refactor sdk-angular per usare sdk-browser - COMPLETATO
- [x] Fase 13: Refactor sdk-svelte per usare sdk-browser - COMPLETATO

## Architettura Target

Documento completo: **`docs/SDK-ARCHITECTURE.md`**

Leggere SEMPRE questo file come riferimento prima di implementare SDK.

## Status

**Fase 8 COMPLETATA** - Test E2E funzionante!

### Verifiche completate

- [x] sdk-browser compila senza errori
- [x] browser-adapter si avvia su porta 8000/8001
- [x] browser-entity (Vite) si avvia su porta 5173
- [x] TypeScript type check passa
- [x] BrowserTestService creato (protocollo LaunchDarkly)
- [x] SDKService interface creata
- [x] Test harness aggiornato per supportare browser services
- [x] Tutti i test file aggiornati per usare SDKService interface
- [x] **TEST E2E FUNZIONANTE** - Client creation, flag evaluation, client deletion

### Test E2E Results (2026-01-30)

| Operazione               | Endpoint            | Risultato          |
| ------------------------ | ------------------- | ------------------ |
| Create client            | `POST /`            | ✓ HTTP 201         |
| Evaluate `test-flag`     | `POST /clients/0`   | ✓ `enabled: true`  |
| Evaluate `enabled-flag`  | `POST /clients/0`   | ✓ `enabled: true`  |
| Evaluate `disabled-flag` | `POST /clients/0`   | ✓ `enabled: false` |
| Delete client            | `DELETE /clients/0` | ✓ HTTP 200         |

## File Creati

### sdk-browser (nuovo SDK)

- `packages/sdk-browser/package.json`
- `packages/sdk-browser/tsconfig.json`
- `packages/sdk-browser/src/index.ts`

### browser-adapter

- `test-harness/browser-adapter/package.json`
- `test-harness/browser-adapter/tsconfig.json`
- `test-harness/browser-adapter/src/index.ts`

### browser-entity

- `test-harness/browser-entity/package.json`
- `test-harness/browser-entity/tsconfig.json`
- `test-harness/browser-entity/vite.config.ts`
- `test-harness/browser-entity/index.html`
- `test-harness/browser-entity/src/main.ts`
- `test-harness/browser-entity/src/TestHarnessWebSocket.ts`
- `test-harness/browser-entity/src/ClientEntity.ts`
- `test-harness/browser-entity/src/types.ts`

### Script

- `test-harness/run-browser-tests.sh`

## Prossimi Passi

1. Installare dipendenze e buildare
2. Adattare test harness Go per protocollo LaunchDarkly
3. Testare end-to-end
