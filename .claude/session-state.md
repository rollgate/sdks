# Session State - Rollgate SDKs

Questo file traccia il lavoro svolto in ogni sessione Claude.

---

## Sessione 2026-02-01 (Contract Test Dashboard)

### Obiettivo
Implementare dashboard per monitorare contract tests e fixare bug conteggio.

### Lavoro Completato

1. **Fix bug conteggio runner** (`test-harness/dashboard/runner.go`)
   - Problema: il runner contava il primo evento (pass/fail/skip) per ogni test, ma quando un subtest falliva prima del parent, veniva contato come fallimento
   - Soluzione: ignorare eventi subtest (quelli con "/" nel nome) e contare solo eventi parent test
   - Commit: `38fbc0f fix(dashboard): count only parent test events, ignore subtests`

2. **Verifica test**
   - sdk-node: 84/84 PASS
   - sdk-go: 84/84 PASS

### Stato SDK

| SDK | Test Service | Porta | Status |
|-----|--------------|-------|--------|
| sdk-node | Node.js | 8001 | 84/84 PASS |
| sdk-go | Go | 8003 | 84/84 PASS |
| sdk-java | Java | 8005 | 84/84 PASS |
| sdk-python | Python | 8004 | Skeleton |
| sdk-browser | Browser | 8000 | Richiede Playwright |
| sdk-react | Browser | 8010 | Richiede Playwright |
| sdk-vue | Browser | 8020 | Richiede Playwright |
| sdk-svelte | Browser | 8030 | Richiede Playwright |
| sdk-angular | Browser | 8040 | Richiede Playwright |
| sdk-react-native | N/A | - | Non testabile (mobile) |

### Branch
`feat/test-dashboard`

### Prossimi Step
- [ ] Completare sdk-python test service
- [ ] Configurare browser SDK con Playwright
- [ ] Push branch e creare PR

---

## Template Nuova Sessione

```markdown
## Sessione YYYY-MM-DD (Titolo)

### Obiettivo
[Descrizione obiettivo]

### Lavoro Completato
1. [Task 1]
2. [Task 2]

### Branch
[nome branch]

### Prossimi Step
- [ ] [Step 1]
- [ ] [Step 2]
```
