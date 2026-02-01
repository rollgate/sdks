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

2. **Documentazione**
   - Creato `.claude/session-state.md` per tracciare sessioni
   - Aggiornato `CLAUDE.md` con info dashboard e workflow
   - Aggiornato `test-harness/dashboard/README.md`
   - Commit: `1f9531a docs: add session-state tracking and update CLAUDE.md`

3. **Miglioramenti dashboard frontend** (`test-harness/dashboard/static/index.html`)
   - Aumentato altezza lista test da 200px a 400px
   - Mostra tutti gli 84 test invece degli ultimi 10
   - Test falliti mostrati per primi (in rosso), poi skipped, poi passed
   - Commit: `520b026 feat(dashboard): show all tests with failed first`

### Stato SDK (risultati reali dopo fix)

| SDK | Test Service | Porta | Pass | Fail | Note |
|-----|--------------|-------|------|------|------|
| sdk-node | Node.js | 8001 | 84 | 0 | ✓ Completo |
| sdk-go | Go | 8003 | 62 | 22 | Bug in targeting/identify |
| sdk-java | Java | 8005 | 82 | 2 | Bug in AttributeNull, ConcurrentEvaluations |
| sdk-python | Python | 8004 | - | - | Skeleton (non implementato) |
| sdk-browser | Browser | 8000 | - | - | Richiede Playwright |
| sdk-react | Browser | 8010 | - | - | Richiede Playwright |
| sdk-vue | Browser | 8020 | - | - | Richiede Playwright |
| sdk-svelte | Browser | 8030 | - | - | Richiede Playwright |
| sdk-angular | Browser | 8040 | - | - | Richiede Playwright |
| sdk-react-native | N/A | - | - | - | Non testabile (mobile) |

### Bug Rilevati negli SDK

**sdk-go (22 test falliti):**
- TestIdentify, TestReset
- TestAttributeEmpty, TestAttributeBoolean, TestAttributeNumber
- TestManyAttributes, TestETagWithUserContext
- TestAttributeTargeting, TestMultipleConditions
- Tutti i test Operator (Eq, Neq, Contains, StartsWith, EndsWith, Gt, Lte, In, NotIn, Regex, SemverGt, SemverEq, CombinedOperators)

**sdk-java (2 test falliti):**
- TestAttributeNull
- TestConcurrentEvaluations

### Branch
`feat/test-dashboard`

### Commits
```
520b026 feat(dashboard): show all tests with failed first
1f9531a docs: add session-state tracking and update CLAUDE.md
38fbc0f fix(dashboard): count only parent test events, ignore subtests
```

### Prossimi Step
- [ ] Push branch e creare PR
- [ ] Fixare bug in sdk-go (targeting/operators)
- [ ] Fixare bug in sdk-java (AttributeNull, ConcurrentEvaluations)
- [ ] Completare sdk-python test service
- [ ] Configurare browser SDK con Playwright

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
