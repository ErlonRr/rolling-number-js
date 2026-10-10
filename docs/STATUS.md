# Stato del progetto

Ultimo aggiornamento: 2026-10-10. Questo file riassume il lavoro fatto e quello che resta, per chi riprende il progetto (persone o agenti AI). Dettagli tecnici in `docs/AUDIT.md` (audit e roadmap) e `docs/design/v1.3.md` (specifica v1.3).

## Fatto

### 1. Audit della v1.2.1 → `docs/AUDIT.md`
- 6 aree analizzate (render/animazioni, iniezione negli host, adapter, packaging/SSR, a11y/i18n, DX), ogni finding verificato da agenti indipendenti con riproduzioni reali (happy-dom, Chromium, Firefox, Angular 18, React 18/19, Vue 3.5).
- Risultato: 40 bug confermati (B01–B40), circa 25 migliorie (I01–I26), 5 segnalazioni non verificate (C1–C5), roadmap in tre fasi: v1.2.x, v1.3, v2.0.

### 2. Patch v1.2.x → branch `fix/v1.2.x-audit` (pushato, PR da aprire verso `main`)
- Correzioni non breaking su core, web component, React, Vue e Angular. In particolare i 3 bug critici:
  - Angular ora è compilato Ivy partial con `ngc` (B01) e verificato in build AOT reali su 16.2, 18.2 e 22.2;
  - React non include più il proprio `jsx-runtime` (B02): 1,8 kB invece di 21,7, compatibile con React 19;
  - l'import in Node/SSR non va più in crash (B03).
- Tipizzazione per IDE e AI: JSDoc completo nei `.d.ts`, tipi ESM/CJS, `rolling-number/jsx`, `rolling-number/vue-element`, `custom-elements.json`, file di autocompletamento per VS Code.
- Qualità: 189 test (vitest + happy-dom), script `typecheck`, `test`, `smoke`, `check:ng-aot`, `lint:pkg` e `prepublishOnly` che li esegue tutti.
- Documentazione: README corretto, `CHANGELOG.md` (voce "Unreleased — 1.2.2"), `AGENTS.md`.
- Revisione avversariale finale: 15 problemi confermati, tutti corretti.

### 3. Design della v1.3 → branch `feat/v1.3` (basato su `fix/v1.2.x-audit`)
- Due architetture opposte (compatibilità e leggerezza / qualità visiva e API), critica avversariale di ciascuna, sintesi e doppia revisione della specifica.
- Specifica finale in `docs/design/v1.3.md` (revisione 2): API pubblica, interfacce tra moduli, 12 pacchetti di lavoro (WP0–WP11), matematica del contachilometri verificata in Chromium (5.921 animazioni casuali e 2.788 cambi di target a metà corsa, tutti con valore finale esatto), piano di test, registro dei rischi e voci rinviate.

## Da fare

### Subito (proprietario)
1. Aprire e unire la PR `fix/v1.2.x-audit` → `main`:
   https://github.com/ErlonRr/rolling-number-js/compare/main...fix/v1.2.x-audit?expand=1
2. Rilasciare la 1.2.2: bump di `package.json` (oggi 1.2.1), data nel CHANGELOG, `pnpm publish` (esegue `prepublishOnly`).
3. Decidere le voci S1–S6 del §0 di `docs/design/v1.3.md`. Senza risposta si procede con il default "ship":
   - **S1**: `setValue()` restituisce una Promise invece di `void`;
   - **S2**: `update({ duration: null })` riporta la durata al default automatico;
   - **S3**: anche le rotazioni con `interpolate:false` sono guidate da JS, quindi il DOM è definitivo solo a `rn-end`;
   - **S4**: `--rn-duration`/`--rn-easing` personalizzati regolano anche il conteggio;
   - **S5**: una `duration` esplicita regola anche le rotazioni;
   - **S6**: a metà conteggio i `data-digit` delle colonne non formano più il numero intermedio.

### v1.3 — implementazione (branch `feat/v1.3`)
Ordine previsto dalla specifica (§3):
1. **WP0 Foundation**: tipi, opzioni, contratti tra moduli, stub, entry, exports.
2. **In parallelo**:
   - WP1: motore di animazione;
   - WP2: formattazione `Intl` e SSR;
   - WP3: renderer a colonne e CSS;
   - WP4: modalità testo, accessibilità e visibilità;
   - WP5: iniezione degli stili, build IIFE, CI, Playwright.
3. **In parallelo**:
   - WP6: orchestratore del core;
   - WP7: web component, azione `rollingNumber()` e tipi;
   - WP8: React;
   - WP9: Vue;
   - WP10: Angular.
4. **WP11**: test visivi Playwright su 3 motori, demo su `dist`, documentazione.
5. Revisione avversariale, correzioni, commit, PR `feat/v1.3` → `main` (dopo l'unione della 1.2.x).

### v2.0 — breaking (dopo la v1.3)
Sottoalbero `.rn-root` gestito dal core con l'host intatto, rimozione di `role="img"`, `textContent` pulito, entry principale senza auto-registrazione, rimozione dell'euristica `-input` di Angular, semantica di riconnessione del custom element, Shadow DOM opzionale con `::part`. Dettagli in `docs/AUDIT.md` §5 e `docs/design/v1.3.md` §13.

## Decisioni prese
- Tutti gli adapter restano di prima classe, Angular incluso e compilato correttamente: non si passa a un pacchetto solo vanilla.
- La tipizzazione (IDE e lettura da parte di AI) è una priorità.
- Commit e push autonomi solo su branch diversi da `main`; le PR le unisce il proprietario.
- Se una domanda resta senza risposta si procede con l'opzione consigliata.
