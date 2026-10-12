# Audit tecnico: rolling-number-js v1.2.1

Audit eseguito il 2026-10-10 sulla v1.2.1 (commit `cdf2fc2`). Le riproduzioni sono state eseguite su una copia isolata del repository usando happy-dom/jsdom, Chromium e Firefox headless, Angular 18.2.14, React 18.3.1/19.x e Vue 3.5.

Ogni voce ha un codice breve: B = bug, I = miglioria, C = segnalazione del critic. Il codice originale del finding è tra backtick.

---

## 1. Panoramica del progetto

**Struttura e entry point**

| Export (`package.json`) | Sorgente | Ruolo |
|---|---|---|
| `.` | `src/index.ts` | Riesporta `RollingNumberCore`, `RollingNumberElement` e `defineRollingNumber`. All'import registra `<rolling-number>` come side effect (`index.ts:7-9`). |
| `./register` | `src/register.ts` | Registra solo il custom element. |
| `./react` | `src/react/*` | Hook `useRollingNumber(ref, opts)` e componente `<RollingNumber>` (uno `<span>`). |
| `./vue` | `src/vue/*` | Componente `RollingNumber` (uno `span`) e direttiva `v-rolling-number`. |
| `./angular` | `src/angular/rolling-number.directive.ts` | Direttiva standalone `[rollingNumber]` con un'euristica `tagName.includes('-input')`. |
| `./style.css` | `src/rolling-number.css` | Viene estratto da Vite in `dist/style.css`. |

- **Build**: Vite in modalità lib multi-entry, formati `es` e `cjs`, tipi con `vite-plugin-dts` (`rollupTypes:false`). La CSS è estratta in un file separato e non esiste una build IIFE.
- **Tooling assente**: test, lint, CI e `prepublishOnly`. Gli unici script sono `dev`, `build`, `build:demo` e `preview` (`package.json:50-55`).
- **Agenti**: nella root non c'è un AGENTS.md o un CLAUDE.md. `skills-lock.json` elenca 8 skill, ma `.agents/` è in `.gitignore:11`, quindi chi clona il repo non può riprodurle.
- **Demo**: `index.html` importa `./src/index`. In dev Vite inietta la CSS, e questo nasconde i problemi di packaging.

**Come funzionano render e animazione (`src/core.ts`)**

1. `initDOM()` (`core.ts:49-54`) aggiunge la classe `rn-rolling-number` e `role="img"` **direttamente sull'host**.
2. `render()` (`core.ts:111-165`):
   - scrive `aria-label` sull'host;
   - fa `prepend` del segno `−` (U+2212);
   - fa `append` di una `.rn-col` per ogni cifra.
   Ogni `.rn-col` contiene una `.rn-sizer` (la cifra corrente, `visibility:hidden`, che dà la larghezza alla colonna) e una `.rn-scale` con 10 `.rn-cell` "0".."9". La posizione della scala si ottiene in CSS con `[data-digit="N"] > .rn-scale { translateY(-N*10%) }` (`rolling-number.css:63-72`), su una finestra alta `1lh` con `overflow:hidden`.
3. `setValue()` (`core.ts:170-221`) ha due modalità:
   - **`interpolate=true`** (default): aggiunge `.rn-interpolating`, che imposta `transition:none !important`, poi un loop rAF con easeOutCubic su `duration` (400 ms) interpola `displayValue`. A ogni frame arrotonda il valore e riscrive `data-digit`.
   - **`interpolate=false`**: cambia solo `data-digit` e lascia la transizione CSS `--rn-duration` (0,5 s).
4. `destroy()` esegue `container.innerHTML = ''` (`core.ts:297`).

**Conseguenza architetturale**: il core scrive dentro l'host e ne modifica stile, ruolo e attributi. Per questo il requisito "iniettabile in input, div, span e componenti" non regge. Gran parte dei bug in questa pagina nasce da qui.

---

## 2. Bug confermati

Ordinati per severità. La severità segue la calibrazione dei verifier; dove i due verifier non concordano è indicata quella adottata.

| # | Sev. | Titolo | file:line | Scenario (input → osservato) | Verifica |
|---|---|---|---|---|---|
| B01 `dx-quality-angular-entry-unusable` | **critica** | L'entry Angular è compilata con decorator TC39 e senza metadati Ivy | `src/angular/rolling-number.directive.ts:12-25`, `vite.config.ts:11`, `tsconfig.json` | `import { RollingNumberDirective } from 'rolling-number/angular'` → throw al load: "Standard Angular field decorators are not supported in JIT mode". In AOT mancano `ɵdir`/`ɵfac`. | Confermato 2/2, riprodotto (ESM e CJS, @angular/core 18.2.14) |
| B02 `packaging-wc-react-bundles-jsx-runtime` | **critica** | `dist/react.js` include il `react/jsx-runtime` di React 18 | `vite.config.ts:24-25`, `tsconfig.json:13`, `dist/react.js:25,55,635` | React 19 / Next 15 → `TypeError ... 'ReactCurrentOwner'/'ReactCurrentDispatcher'`. Senza bundler: `process is not defined`. Bundle di 21,7 KB contro meno di 1 KB di codice proprio. | Confermato 2/2, riprodotto (React 19.3.0, fix testato) |
| B03 `packaging-wc-ssr-htmlelement-referenceerror` | alta | Importare `.` o `/register` in Node lancia `HTMLElement is not defined` | `src/element.ts:3`, `src/index.ts:1-9`, `src/register.ts:1-3` | `import { RollingNumberCore } from 'rolling-number'` (l'esempio del README a `:282`) in SSR → ReferenceError durante la valutazione del modulo. | Confermato 2/2, riprodotto (ESM e CJS) |
| B04 `adapters-angular-ssr-crash` | alta (latente) | La direttiva Angular crea il core in `ngOnInit` anche sul server | `directive.ts:27-29,43`, `core.ts:78,83,89,94,121,211,220` | Angular SSR → `ReferenceError: document is not defined` (`core.ts:78`). platform-server definisce `HTMLElement` ma non `document`. Oggi il problema è nascosto da B01. | Confermato 2/2, riprodotto (`renderApplication` su Angular 18, domino) |
| B05 `host-injection-input-textarea-invisible` | alta | Su `<input>`/`<textarea>` le colonne finiscono come figli invisibili | `core.ts:49-54,116,138-144,297` | `new RollingNumberCore(input,{value:42})` → 2 span che il browser non disegna, `value` resta "5", e `role=img` sovrascrive la label. Su `<textarea>`, `destroy()` cancella `defaultValue`. | Confermato 2/2, riprodotto (happy-dom) |
| B06 `render-animation-default-mode-no-roll` | alta | Con il default `interpolate=true` le cifre non rotolano mai | `core.ts:197-215`, `rolling-number.css:15-18` | 5→6: scatto secco a 96 ms. 0→1000: 115, 221, 319… cifre casuali in stile slot machine, nessun effetto odometro. | Confermato 2/2, riprodotto (rAF simulato) |
| B07 `host-injection-framework-class-clobber` | alta | Le classi gestite dal framework cancellano `rn-rolling-number` e `rn-interpolating` | `core.ts:50-51,180,197,215`, `react/RollingNumber.tsx:21`, `vue/RollingNumber.ts:51`, `vue/vRollingNumber.ts:12` | `className={a?'a':'b'}` / `:class` che cambia → `class="b"`: si perde il layout e, se capita durante l'animazione, le transizioni CSS si scontrano con il rAF. | Confermato 2/2 (alta/media), riprodotto (React 18, Vue 3) |
| B08 `a11y-i18n-rtl-reversed-digits` | alta | In un contesto `dir="rtl"` le cifre sono invertite | `rolling-number.css:6-13`, `core.ts:125,143` | `<p dir=rtl>` con 1234 → "4321"; −42 → "24−". | Confermato 2/2 (alta/media), riprodotto (screenshot Firefox, fix verificato) |
| B09 `packaging-wc-css-not-shipped-with-js` | media | La CSS non viaggia con il JS | `core.ts:1`, `vite.config.ts:31-34`, `package.json:9,44` | `import 'rolling-number/register'` senza `style.css` → ogni colonna mostra la sizer più "0123456789". | Confermato 2/2, riprodotto (nessuno `<style>` iniettato) |
| B10 `packaging-wc-pre-upgrade-property-lost` | media | Una proprietà impostata prima dell'upgrade oscura per sempre l'accessor | `element.ts:10-24,50-111` | `el.value=7` prima di `define` → mostra 0, e ogni `el.value=…` successivo viene ignorato. | Confermato 2/2, riprodotto |
| B11 `a11y-i18n-role-img-overrides-host-semantics` | media | `role=img` e `aria-label` finiscono sull'host | `core.ts:53,116,297`, `vue/vRollingNumber.ts`, `README.md:74,221` | `<button>Cart</button>` viene letto "5, image". Su PrimeVue `<InputNumber v-rolling-number>` l'input esce dall'albero di accessibilità e all'unmount viene cancellato. | Confermato 2/2, riprodotto |
| B12 `host-injection-existing-content-and-destroy` | media | Il contenuto già presente si mescola alle colonne e `destroy()` lo cancella | `core.ts:125,143,291-300` | `<p>Score: <b>pts</b></p>` con −15 → "−Score: pts15". Dopo `destroy` l'host è vuoto ma conserva class, role e aria-label. Un fallback SSR "42" diventa "4242". | Confermato, riprodotto |
| B13 `host-injection-framework-children-conflict` | media | I figli gestiti dal framework cancellano le colonne | `react/RollingNumber.tsx:5,21`, `useRollingNumber.ts:14`, `vRollingNumber.ts:12` | `<RollingNumber>{label}</RollingNumber>`: quando la label cambia le colonne spariscono per sempre. `<span v-rolling-number>{{x}}</span>` fa lo stesso. | Confermato, riprodotto (React, StrictMode, Vue) |
| B14 `a11y-i18n-textcontent-copy-garbage` | media | `textContent` contiene "0123456789" per ogni colonna | `core.ts:77-103`, `rolling-number.css:11,35-37` | 42 → `"4012345678920123456789"`, quindi `getByText('42')` fallisce. Copia-incolla e Ctrl+F non trovano il numero. | Confermato 2/2, riprodotto (textContent). Copia/find dedotti dalla CSS, non provati in browser |
| B15 `dx-quality-input-normalization` | media | Input non validi non vengono normalizzati | `core.ts:35-40,171,241,257-258,268-272`, `element.ts:61-62,72-80` | `'abc'` → colonne N/a/N con aria "NaN". `el.max=undefined` → TypeError. `max=""` → tutto a 0. 1e21 → "10021". Dopo un NaN l'animazione successiva resta bloccata. | Confermato, riprodotto |
| B16 `packaging-wc-setter-null-throws-double-setvalue` | media | I setter lanciano su null/undefined e chiamano `setValue` due volte | `element.ts:54-59,63-67,72-84,106-110` | `el.value=null` (React 19 su rimozione di una prop) → TypeError, anche per pad e duration. `el.value=9` → 2 chiamate a `setValue` e l'animazione riparte. | Confermato, riprodotto |
| B17 `render-animation-final-frame-rewind` | media | Sull'ultimo frame il cambio di cifra e la rimozione della classe avvengono nello stesso style recalc | `core.ts:210-216` | 0→1000000: dipende dalla fase del frame. Se l'ultimo frame cambia cifre, le colonne tornano indietro per 0,5 s (9→0 passando per 8..1). | Confermato 2/2, riprodotto (Chromium/Playwright, fix verificato) |
| B18 `render-animation-column-identity` | media | Le colonne sono riconciliate da sinistra | `core.ts:134-164` | 99→100 senza interpolate: la vecchia colonna delle decine diventa centinaia e rotola 9→1 all'indietro, mentre la nuova colonna delle unità appare ferma. | Confermato 2/2, riprodotto |
| B19 `render-animation-wrap-backwards` | media | 9→0 percorre l'intera scala all'indietro | `rolling-number.css:43-72`, `core.ts:88-98` | 19→20: le unità vanno da −90% a 0% (sembra un conto alla rovescia) mentre le decine salgono. | Confermato, riprodotto |
| B20 `render-animation-line-height-override` | media | `line-height:1` fisso sulle celle contro `1lh` sulla colonna | `rolling-number.css:10,27-41,54-60` | `line-height:1.5` sull'host → finestra di 60 px con step di 40 px: si vede "5" più metà del "6". | Confermato, riprodotto (Chromium). Nota: non scatta per semplice ereditarietà, serve uno stile diretto sul root |
| B21 `packaging-wc-types-masquerading-esm` | media | I `.d.ts` non funzionano con node16/nodenext e con CJS | `package.json:17-44`, `vite.config.ts:41-44`, `dist/index.d.ts:1-2` | `moduleResolution: node16` → TS2834. In CJS: "Masquerading as ESM". Con node10 i subpath non si risolvono. | Confermato, riprodotto con tsc (attw è andato in crash) |
| B22 `host-injection-host-style-clobber` | media | Gli stili base finiscono sull'host | `core.ts:49-52`, `rolling-number.css:6-13` | `<td>` e `<li>` diventano inline-flex, `[hidden]` smette di nascondere, un `<div>` diventa inline e non selezionabile. | Confermato 2/2, riprodotto (stili calcolati) |
| B23 `host-injection-angular-target-heuristic` | media | Euristica `includes('-input')` sul nome del tag | `directive.ts:38-50` | `<input matInput>` → colonne invisibili. `<p-inputNumber>` → numero mostrato due volte. `<p-inputSwitch>` → match per caso. Lo span iniettato non viene rimosso. | Confermato, riprodotto |
| B24 `adapters-angular-zone-cd-per-frame` | media | Il rAF gira dentro zone.js | `directive.ts:27-35,61-62`, `core.ts:211,220` | 20 badge: una change detection su tutta l'app a ogni frame, cioè centinaia di tick al secondo. | Confermato, riprodotto (zone.js 0.14 con NgZone) |
| B25 `adapters-react-no-ref-forwarding` | media | Manca `forwardRef` | `react/RollingNumber.tsx:7-21` | React 18: `ref` resta null (si rompono Radix asChild e MUI Tooltip). React 19: la ref del consumer sostituisce quella interna e il contatore non si monta. | Confermato, riprodotto (18 e 19) |
| B26 `adapters-react-hook-stale-element` | media | L'hook non si aggancia a un elemento montato in ritardo o sostituito | `useRollingNumber.ts:10-18` | `show && <span ref>` → resta vuoto finché un'opzione non cambia. Con uno swap di tag continua a scrivere sul nodo staccato. | Confermato, riprodotto (verifier ha alzato a media) |
| B27 `packaging-wc-define-second-tag-throws` | media | `defineRollingNumber('my-counter')` lancia NotSupportedError | `element.ts:117-123`, `index.ts:6-9` | Dopo l'auto-registrazione: "this constructor has already been used". | Confermato, riprodotto (fix con subclass verificato) |
| B28 `a11y-i18n-user-aria-label-clobbered` | media | L'`aria-label` dell'autore viene sovrascritto | `core.ts:53,116` | `aria-label="Items in cart"` → "3". | Confermato, riprodotto |
| B29 `a11y-i18n-no-reduced-motion` | bassa | `prefers-reduced-motion` è ignorato | `rolling-number.css:23,50`, `core.ts:179-220` | Con "riduci movimento" attivo, rotazione e conteggio partono comunque. Contraddice "Accessible" in `README:35`. | Confermato da lettura del codice |
| B30 `render-animation-max-semantics` | bassa | `max` non è validato, il clamp è sul modulo e manca "99+" | `core.ts:38,59-63,116,257-262` | `max=9.5` → "905". `max=-1` → "01". 150 con max 99 → "99", ma la label dice "150". −1.5 → −1. | Confermato, riprodotto |
| B31 `dx-quality-vue-directive-types-and-churn` | bassa | Al tipo del binding Vue mancano `interpolate` e `duration`, e la direttiva fa un render a ogni update | `vRollingNumber.ts:6,15-22`, `core.ts:283-285` | vue-tsc → TS2353. Ogni re-render del padre esegue `render()`. | Confermato, riprodotto (tsc + happy-dom) |
| B32 `render-animation-negative-elapsed-sign-flash` | bassa | Il primo frame può avere `elapsed` negativo | `core.ts:198-207` | `setValue` chiamato da uno scroll handler, 0→1000 → primo frame "−2" con il segno visibile. | Confermato, riprodotto (rAF simulato) |
| B33 `render-animation-duration-easing-split` | bassa | `duration` (JS) e `--rn-duration`/`--rn-easing` (CSS) sono indipendenti | `core.ts:12-13,40,204-205`, `rolling-number.css:1-4,15-18,50` | Le variabili CSS del README non hanno effetto in modalità default. Con `interpolate=false`, `duration` non ha effetto. | Confermato da lettura del codice |
| B34 `render-animation-sign-abrupt` | bassa | Il segno compare e scompare di colpo | `core.ts:118-132`, `rolling-number.css:15-25` | 5→−5: il segno è subito a opacity 1 e le cifre saltano di lato. La transition di opacity è codice morto. | Confermato, riprodotto |
| B35 `adapters-react-missing-use-client` | bassa | Manca `'use client'` | `dist/react.js:1`, `README.md:3,134` | Next App Router con un Server Component → errore di build. | Confermato, riprodotto (fix con `output.banner` testato) |
| B36 `host-injection-host-validation-svg-realm` | bassa | `instanceof HTMLElement` non è realm-safe e si usa il `document` globale | `core.ts:29-32,78,83,89,94,121` | Elemento di un iframe o di una finestra PiP → throw. I nodi vengono creati nel documento sbagliato. | Confermato, riprodotto (jsdom cross-realm) |
| B37 `host-injection-double-init` | bassa | Un secondo core sullo stesso host duplica le cifre | `core.ts:29-44` | 42 → "4242". L'istanza vecchia continua a riscrivere `aria-label`. | Confermato, riprodotto |
| B38 `adapters-angular-input-coercion` | bassa | Gli input Angular stringa non vengono convertiti | `directive.ts:17-21,30-34,55-57` | `interpolate="false"` anima lo stesso. `[interpolate]="0"` si comporta diversamente tra init e change. | Confermato, riprodotto (rebuild con esbuild) |
| B39 `packaging-wc-reconnect-destroys-state` | bassa | Un move o un re-insert distrugge e ricostruisce il DOM | `element.ts:14-31`, `core.ts:291-300` | Reorder di una lista durante l'animazione → salto al valore finale e nodi ricreati. | Confermato, riprodotto |
| B40 `a11y-i18n-find-scrolls-overflow-hidden` | bassa | Ctrl+F o `scrollIntoView` scrollano `.rn-col` | `rolling-number.css:29`, `core.ts:93-97` | `scrollTop=256` resta impostato, quindi viene mostrata la cifra sbagliata ("16" invece di "12"). | Confermato, riprodotto (Firefox headless) |

### Segnalazioni del critic (una sola fonte, NON verificate in modo indipendente)

| # | Sev. proposta | Titolo | file:line | Scenario | Stato |
|---|---|---|---|---|---|
| C1 `gradient-text-broken` | alta | Il testo con gradiente (`background-clip:text`) mostra cifre sbagliate o nessuna | `rolling-number.css:27-52` | Lo stesso stile dell'h1 della demo, applicato al contatore, non lo disegna o ne disegna frammenti. | Non verificato (critic: Chromium, `crit/p3.png`, `grad.png`) |
| C4 `trusted-types-destroy` | media | `innerHTML=''` lancia un'eccezione con una CSP Trusted Types | `core.ts:297` | `require-trusted-types-for 'script'` → TypeError a ogni unmount, e le colonne restano nel DOM. | Non verificato (critic: Chromium) |
| C2 `text-effects-clipped` | media | `text-shadow` e le sporgenze dei glifi vengono tagliate | `rolling-number.css:27-32` | Il glow del contatore hero della demo (`index.html:114`) è tagliato netto. | Non verificato (critic: Chromium) |
| C3 `text-decoration-lost` | media | Sottolineatura e barrato del padre non arrivano alle cifre | `rolling-number.css:6-13,27-31,43-52` | Dentro `<s>` o `<a>` il numero non è barrato né sottolineato. | Non verificato (critic: Chromium) |
| C5 `huge-nonfinite-values-pad` | bassa | Infinity, 1e21 e `pad` senza limite | `core.ts:35,37,59-72,248,269` | `pad=Infinity` → RangeError. `pad=20000` → 260k nodi in circa 15 s. | Non verificato (critic: happy-dom). Si sovrappone in parte a B15 |

---

## 3. Migliorie: rendering e animazioni

### 3.1 Redesign chiave: root interno di proprietà del core e odometro continuo
Risolve B05, B06, B07, B08, B11, B12, B13, B14, B17-B20, B22, B28, B34, B40, C4, I01, I02 e I03.

**Struttura DOM proposta.** Il core non tocca mai ruolo, classi, stile o figli dell'host.

```html
<!-- host: div/span/td/button/… invariato -->
<span class="rn-root" data-rn-state="idle|animating">     <!-- direction:ltr; unicode-bidi:isolate -->
  <span class="rn-sr">−1.234</span>                      <!-- unico testo reale, visually-hidden -->
  <span class="rn-visual" aria-hidden="true">
    <span class="rn-sign" data-hidden>−</span>           <!-- persistente, max-width/opacity in transizione -->
    <span class="rn-col" style="--rn-pos:4.37"><span class="rn-scale"></span></span>
    <span class="rn-static">.</span>                     <!-- separatori/affissi da formatToParts -->
  </span>
</span>
```

**Regole CSS di base:**
- `.rn-scale::before { content:"0\A 1\A … 9\A 0"; white-space:pre }`: 11 righe generate (0..9 più una cella di wrap). Il contenuto generato non compare in `textContent`, nella ricerca o nella copia, e si eliminano circa 10 nodi per colonna (B14, C9).
- La larghezza della colonna viene da una `::after` con la cifra più larga, oppure da una grid con le dieci cifre sovrapposte. Non dipende più dalla cifra corrente (I07).
- `transform: translateY(calc(var(--rn-pos) * -1lh))`, con fallback `calc(var(--rn-lh,1) * -1em)`. `line-height: var(--rn-lh, 1)` sta solo su `.rn-root` e i figli lo ereditano (B20).
- `.rn-col { overflow:hidden; overflow:clip }` (B40). Un'area di sfondamento opzionale, `--rn-bleed` più `mask-image`, evita di tagliare glow e glifi (C2).
- `@media (prefers-reduced-motion: reduce)` disattiva le transizioni (B29).
- `will-change: transform` si applica solo con `[data-rn-state=animating]` (I06).
- Lo stato "interpolating" diventa un data-attribute sul root, così i framework non lo cancellano (B07).

**Odometro continuo.** Le formule sono state corrette dai verifier: lo sketch originale aveva sbagliato sia le unità della traslazione sia il carry per k≥2.

```ts
const a = Math.abs(display);                    // float, per frame
cols.forEach((col, k) => {                      // k = 0 → unità (chiave per posizione da destra)
  const p = 10 ** k, d = Math.floor(a / p) % 10;
  const pos = k === 0 ? d + (a % 1)
                      : d + Math.max(0, (a % p) - (p - 1));   // si muove solo durante il carry
  col.style.setProperty('--rn-pos', String(pos));
});
// ultimo frame: pos intere (10 → 0) con transition:none; poi flush dello stile (offsetWidth) prima di tornare a idle
```

- La cella 10 ("0") rende continuo il wrap in **entrambe** le direzioni, quindi non serve una cella 9 iniziale.
- Il percorso CSS `data-digit`, con transizione, resta solo per `interpolate=false` e reduced motion. Lì il wrap dipende dalla direzione (cella 10 e snap su `transitionend`).
- **Riconciliazione delle colonne (B18)**: `digitCols[0]` corrisponde alle unità. Le colonne di ordine superiore si inseriscono dopo il segno e si rimuovono dalla testa. Le colonne che entrano partono da `pos=0` con fade e larghezza animati.
- **Timing (B32, B17, B33)**: `startTime ??= rafTimestamp`, progress limitato a [0,1]. L'ultimo frame viene renderizzato con le transizioni disattivate, poi si forza un flush prima di rimuovere lo stato. `duration` ed `easing` sono un'unica fonte di verità; vedi I23 per evitare di sovrascrivere temi CSS ereditati con stile inline.
- **Retarget (I08)**: si mantiene la velocità, sommando il delta al target in volo invece di ripartire con easeOutCubic. Come alternativa opt-in, una molla criticamente smorzata. Attenzione: la molla cambia il significato di `duration`.
- **Delta molto grandi**: si limita la velocità visiva delle colonne basse (blur oppure giro a velocità fissa con atterraggio per ultime) per evitare aliasing.

### 3.2 Strategie di render per tipo di host (I02 `host-injection-render-strategy`)
- Opzione `mode: 'auto' | 'columns' | 'text'`. In `auto`, `input`, `textarea`, `select`, `option`, SVG `text`/`tspan` e `title` usano `text`; tutto il resto usa `columns`.
- Il `TextRenderer`:
  - scrive `el.value` per i form control e `textContent` per gli altri host, a ogni frame, con il valore formattato e arrotondato;
  - non scrive figli, ruolo o aria, e non lancia eventi `input`/`change`, così non partono loop con ngModel o v-model;
  - salta l'aggiornamento se `document.activeElement === el`;
  - usa il trattino ASCII per `type=number`.
- Il text mode dà un conteggio che scorre, non colonne che ruotano. Un **overlay** con colonne posizionate sopra l'input può essere opt-in: modifica il padre, che appartiene al framework.
- Primo passo a costo minimo, già nel patch: un warning in dev, oppure un throw, sugli host void o replaced (B05).

### 3.3 Iniezione degli stili e shadow DOM (B09, I03 `packaging-wc-no-shadow-style-encapsulation`)
- Si importa la CSS con `import css from './rolling-number.css?inline'` e si mantiene `style.css` come asset separato.
- Al primo costruttore, in modo lazy e mai al top level (per SSR), si usa `container.getRootNode()` (Document o ShadowRoot). Si crea un `CSSStyleSheet` condiviso dentro `@layer rolling-number { … }` e lo si aggiunge ad `adoptedStyleSheets` se non è già presente. Il fallback è un `<style data-rn>`.
- `@layer` serve perché gli adopted sheet vengono dopo i fogli del documento: senza layer sovrascriverebbero le personalizzazioni dell'utente, ad esempio `:root{--rn-duration}`.
- Opt-out con `injectStyles:false`.
- Lo shadow DOM per `<rolling-number>` (con `::part`) resta un'opzione per v2. `::part` non fa nulla in light DOM (vedi §6).

### 3.4 Formattazione e i18n (I04, I10, I12, C8)
- `format?: Intl.NumberFormatOptions & {locale?} | (n)=>string`. Si usa `formatToParts` per produrre token: le cifre diventano `.rn-col` identificate dalla posizione (parte intera da destra, decimali da sinistra) e i letterali diventano `.rn-static`. Il testo di `.rn-sr` è `format(value)`.
- Glifi nativi: 10 glifi per locale. `data-digit` e `--rn-pos` restano indici 0-9, così la CSS non cambia.
- `font-variant-numeric: var(--rn-numeric, tabular-nums)` solo sul root e `inherit` sui figli (C8, non verificato).

### 3.5 Prestazioni (I05 `render-animation-per-frame-cost`, C9)
- Si scrive `aria-label`/`.rn-sr` solo quando cambia, tramite una cache del testo dell'ultimo render.
- Uscita anticipata se il valore arrotondato e le posizioni non cambiano.
- Riferimenti alle colonne in cache, senza `getAttribute`/`querySelector` a ogni frame.
- Opzionale: un ticker rAF condiviso a livello di modulo e un'IntersectionObserver che fa saltare al valore finale gli host non visibili.

### 3.6 Eventi e controllo (I09, C6, C7)
- `setValue(v, {animate, duration, easing}): Promise<void>`.
- CustomEvent `rn-start`/`rn-end` con `bubbles` e `composed`. Niente due punti nel nome: Angular interpreta `(a:b)` come target globale.
- Opzioni `from` e `trigger:'visible'` per il conteggio all'ingresso nella viewport (C6, non verificato).
- Opzionali: `stagger` (`--rn-i`) e `direction`.
- Fermare la propagazione di `transitionend` all'host (C7, non verificato). Diventa superfluo con l'odometro continuo guidato dal JS.

---

## 4. Migliorie: adapter, packaging, SSR, a11y, DX e test

**Angular**
- Build con ng-packagr in formato APF a compilazione parziale (`ɵɵngDeclareDirective`), compilata con l'Angular minimo supportato (16), separata dalla lib Vite. Il core si importa dall'entry pubblica (B01).
- Core creato in `afterNextRender` (o con `isPlatformBrowser`). Usare `el.ownerDocument` o `Renderer2` invece di `document` (B04).
- `NgZone.runOutsideAngular` per creazione, setter e destroy (B24).
- `booleanAttribute`/`numberAttribute` richiedono il peer `>=16.1` (B38).
- Rimuovere l'euristica sul tag e introdurre `rnTarget` e `rnMode` (B23).

**React**
- Scrivere il componente con `createElement`, senza JSX, così si mantiene il peer `>=16.8`, ed esternalizzare `/^react(\/.*)?$/` (B02).
- `forwardRef` con merge della ref tramite callback stabile; `rest` va spalmato prima della ref interna (B25).
- `className = 'rn-rolling-number ' + className` (B07).
- `Omit<HTMLAttributes,'children'|'dangerouslySetInnerHTML'>` (B13).
- Hook che traccia l'elemento con un proprio `elRef` (`container` nel core è `private`) (B26).
- `useLayoutEffect` isomorfo e banner `'use client'` solo sull'entry react (B35).

**Vue**
- Binding tipizzato come `number | RollingNumberOptions` (B31).
- Uscita anticipata con confronto shallow in `updated()`, e `update()` del core che renderizza solo quando c'è un cambiamento.
- Classe `rn-rolling-number` sul vnode, `expose({ get core(), el, setValue, getValue })`, `interpolate` di tipo `[Boolean,String]` (I18).
- `getSSRProps` sulla direttiva.

**Web component**
- `_upgradeProperty` all'inizio di `connectedCallback` (B10).
- Setter che si limitano a riflettere l'attributo, con guard per null/undefined; il core viene chiamato solo da `attributeChangedCallback` (B16).
- Una subclass per ogni tag in `defineRollingNumber` (B27).
- `destroy` differito (`queueMicrotask` più `isConnected`), oppure nessun destroy alla disconnessione (B39).
- Attributo `no-interpolate`, accettando anche `0`, `off` e `no` (I20).
- `HTMLElementTagNameMap` e augment JSX opzionale (I22). Base class con shim SSR: `const Base = typeof HTMLElement!=='undefined' ? HTMLElement : class{}` (B03).

**Packaging**
- Dichiarazioni con estensione `.js` nei path, `.d.cts` per la condizione `require`, `typesVersions` (B21). Verificare l'output se si passa a `rollupTypes:true`.
- `files:["dist"]`: oggi il pacchetto contiene 664 KB di GIF e PNG su 738 KB (I14).
- Build IIFE in una config separata (`emptyOutDir:false`, senza dts, CSS inline), con campi `unpkg` e `jsdelivr` (I19).
- Root entry pura e auto-registrazione solo in `/register`, poi `sideEffects` come allowlist: **mai** `false` (I21).
- `"./package.json"` negli exports.

**SSR (I17)**
- Fallback statico generato da un helper puro `renderStaticHTML(opts)` e adottato o sostituito dal core al mount. Non va reso come figli gestiti da React, altrimenti si creano conflitti di riconciliazione e un doppio numero.

**Accessibilità**
- Togliere `role=img` dall'host e usare il testo `.rn-sr`: un `<button>` diventa "Cart 5, button" (B11, B28).
- `live?: 'off'|'polite'|'assertive'` con una regione separata che si aggiorna solo a fine animazione, con debounce. Non funziona dentro `role=img` (I11).
- `destroy()` rimuove solo i nodi propri ed elimina `innerHTML` dalla libreria (B12, C4).

**DX e test (I13, I14, I15, I16, I23, I24, I25)**
1. Subito: smoke test che importa ogni export in Node puro (ESM e CJS), più `publint`, `attw --pack`, `tsc --noEmit` e `prepublishOnly`. Avrebbero intercettato B01, B02, B03 e B21.
2. vitest con happy-dom: unit test di core ed element, inclusi host div, span, button, td, input e textarea, e il caso del doppio init.
3. Testing Library con matrice React 18/19 e Vue 3.3/3.5, più un fixture `ng build` per Angular 16/19.
4. Playwright su Chromium, Firefox e WebKit: snapshot visivi, `page.clock` per la metà dell'animazione, RTL, reduced motion, rewind.
5. CI su GitHub Actions, Biome, size-limit per entry, changesets con provenance.
6. AGENTS.md con architettura, convenzioni e comandi. Riconciliare `skills-lock.json` con `.agents/`.

Altri punti:
- README: togliere Svelte oppure aggiungere una ricetta per il web component; correggere "No blocking JS loops" e "99+"; aggiungere API reference, sezione Styling e browser support di `1lh`; correggere gli esempi PrimeNG e PrimeVue.
- Demo: alias `rolling-number` verso `./dist`, `lang` coerente con la lingua attiva più `aria-pressed`, sezioni per span, td, button e input, isole React e Vue.
- `DEFAULT_OPTIONS` e `normalizeOptions` unici nel core. Attenzione: se i wrapper passano `undefined`, oggi `update()` lo interpreta come "invariato" e si perde il reset alla rimozione di una prop. Il core deve normalizzare `undefined` al default.
- `rollingNumber(node, opts) => {update, destroy}`: è un'action Svelte nativa. Solid, Lit e `{@attach}` richiedono piccoli wrapper.

---

## 5. Roadmap proposta

### v1.2.x: patch, solo bug fix non breaking
| Voce | Finding | Effort |
|---|---|---|
| Smoke test di import in Node, publint, attw, typecheck, `prepublishOnly` | I13, I14 | S |
| Entry Angular con ng-packagr (APF parziale) e fixture `ng build` | B01 | M |
| React senza JSX (`createElement`), externals regex, banner `'use client'` | B02, B35 | S |
| Shim di `HTMLElement` per l'import in SSR | B03 | S |
| Direttiva Angular: `afterNextRender`, `ownerDocument`, `runOutsideAngular` | B04, B24, B36 | S |
| `_upgradeProperty`, setter con guard su null e solo riflesso | B10, B16 | S |
| `normalizeOptions` (finite, max ≥0 intero o null, pad 1..64, cifre senza esponente) | B15, B30, C5 | M |
| Flush dell'ultimo frame, clamp di progress, `startTime` dal rAF | B17, B32 | S |
| `direction:ltr; unicode-bidi:isolate`; `overflow:clip`; `--rn-lh` | B08, B40, B20 | S |
| Reduced motion (CSS e `matchMedia`) | B29 | S |
| Merge di `className` e `class` in React/Vue; stato interpolating come data-attribute | B07 | S |
| `forwardRef` React; hook che segue l'elemento; tipi `children` | B25, B26, B13 | S |
| Tipi della direttiva Vue, eliminazione del render superfluo, cache di `aria-label` | B31, I05 | S |
| Subclass per tag in `defineRollingNumber` | B27 | S |
| `destroy()` rimuove solo i nodi propri, niente `innerHTML` | B12, C4 | S |
| Warning in dev su host void o replaced; correzione esempi README e affermazioni false | B05, I15 | S |
| `.d.ts` con `.js`, `.d.cts`, `typesVersions`; `files:["dist"]` | B21, I14 | M |
| `will-change` limitato allo stato animating; `HTMLElementTagNameMap` | I06, I22 | S |

### v1.3: feature additive
| Voce | Finding | Effort |
|---|---|---|
| Odometro continuo, cella di wrap, colonne identificate da destra, segno persistente | B06, B18, B19, B34, I01 | L |
| `mode: auto/columns/text` con text renderer per input e SVG (overlay opt-in) | B05, I02 | M |
| Iniezione automatica degli stili in `@layer` per root (Document/ShadowRoot) | B09, I03 | M |
| `format` Intl, decimali, prefissi e suffissi, glifi nativi, `overflowSuffix` "99+" | I04, I10, I12, B30 | L |
| Eventi `rn-start`/`rn-end`, `setValue` con Promise, `from` e `trigger:'visible'` | I09, I24, C6 | M |
| `duration` ed `easing` unificati tra JS e CSS | B33, I23 | M |
| Retarget che conserva la velocità; larghezza stabile delle colonne | I08, I07 | M |
| Opt-in `live`; markup statico SSR con adozione al mount | I11, I17 | M |
| Build IIFE per CDN; action generica `rollingNumber()`; `expose` Vue | I19, I25, I18 | M |
| `no-interpolate`; coercion Angular (peer `>=16.1`) | I20, B38 | S |
| vitest, Testing Library, Playwright e CI completa; demo su `dist` | I13, I16 | L |
| Supporto ufficiale a gradient e decorazioni del testo (variabili `--rn-fill`, `--rn-bleed`) | C1, C2, C3 | M |

### v2.0: breaking
| Voce | Finding | Effort |
|---|---|---|
| Sottoalbero `.rn-root` di proprietà del core; host intatto; niente `role=img`; testo `.rn-sr`; strip via `::before` | B11, B14, B22, B28, B13 | L |
| Root entry pura (niente auto-define) e `sideEffects` come allowlist | B27, I21 | S |
| Rimozione dell'euristica `-input` in favore di `rnTarget`/`rnMode` | B23 | M |
| Registry `WeakMap` con destroy-and-replace e flag `destroyed` (anche cross-bundle, tramite marker sull'host) | B37 | S |
| Semantica di reconnect del custom element (nessun destroy alla disconnessione) | B39 | S |
| Shadow DOM opzionale per `<rolling-number>` con `::part` | I26 | M |

---

## 6. Rifiutati in verifica

Nessun finding è stato rifiutato per intero. Sono state respinte o corrette le seguenti affermazioni parziali e proposte di fix:

- **B04**: il ReferenceError non avviene a `core.ts:30`. platform-server definisce `HTMLElement` globalmente; l'errore reale è `document is not defined` (`core.ts:78`). Il check realm-safe non serve per l'SSR.
- **B03**: creare la classe in modo lazy dentro `defineRollingNumber()` romperebbe l'export di `RollingNumberElement` e i controlli con `instanceof`. Si usa lo shim della base class.
- **I21**: `sideEffects` da solo non elimina la registrazione (verificato con esbuild e Vite). `sideEffects:false` sarebbe dannoso, perché eliminerebbe la CSS e `/register`.
- **I26 / I03**: `::part` non ha effetto senza shadow DOM. Lo shadow DOM obbligatorio sarebbe breaking.
- **I24**: "nessun handle imperativo in React" è falso, perché `useRollingNumber` restituisce `coreRef`. Anche "nessuna scelta del tag" vale solo per i due componenti.
- **B26**: il fix che confronta `coreRef.current.container` non compila, perché `container` è `private`.
- **I09**: i nomi evento `rolling-number:start/end` vanno scartati: Angular interpreta i due punti come target globale.
- **I01**: nello sketch originale le unità della traslazione erano sbagliate (`10/11` invece di `100/11`) e anche la formula del carry per k≥2. Le versioni corrette sono in §3.1.
- **B06**: il fix minimo "|delta|<10 → percorso CSS" non basta, perché 9→10 riproduce il wrap all'indietro.
- **B33 / I23**: scrivere `--rn-duration` inline sull'host sovrascrive i temi CSS ereditati. Va fatto solo se `duration` è impostata in modo esplicito.
- **I23**: "i wrapper passano solo le prop ricevute" introdurrebbe una regressione sul reset quando una prop viene rimossa.
- **B16**: l'esempio Vue (`:value` null) è debole, perché Vue converte null in 0 sulle proprietà numeriche. Il caso concreto è React 19.
- **B11 / B28**: spostare `aria-label` su uno span interno generico è vietato da ARIA 1.2. Serve testo visually-hidden, non una label.
- **B20**: il problema non scatta per semplice ereditarietà del `line-height`, ma solo con uno stile diretto sul root.
- **I16**: "+100/−100 non tradotti" è stato scartato (sono valori neutri rispetto alla lingua). `duration=0` è voluto (`min="50"`). `innerHTML` nella demo è una questione di stile, non un difetto. Alcuni numeri di riga erano sbagliati: 404, 400, 310-311.
- **I13 / I14**: lo script `test` nel `package.json` della copia è stato aggiunto dai reviewer. Gli script originali sono alle righe 50-55, non 47-52.
- **I07**: `min-width:1ch` non è una soluzione sufficiente.
- **B21**: l'evidenza attw non è riproducibile (attw 0.17/0.18 va in crash). Il problema è confermato con tsc.