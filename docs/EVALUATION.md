# Evaluation: what was tested and how

Last run 2026-10-17 on the branch that added the browser tests. Everything below is reproducible with `npm run verify`; nothing was verified by hand only unless marked.

## Summary

| Layer | Tool | Count | Result |
|---|---|---|---|
| Dataset generation | `tools/gen-data.mjs` | 1,010 events | deterministic (fixed seed), `data/events.json` unchanged by this work |
| Content validation | `tools/validate-content.mjs` | 25 missions | every reference runs; every authored answer proven against the data; every Build starter fails until completed |
| Unit tests | `node --test` | 29 | pass (25 existing + 4 new CSS-token tests) |
| Browser tests | Playwright 1.64.1, Chromium | 8 | pass |
| Mutation checks on the new tests | manual, see below | 4 | each mutation failed the intended test |

Environment for the recorded run: Linux, Node 22.22.0 (npm warns against `engines: >=24` but runs), Chromium build 1194 driven through `PIER9_CHROMIUM` because the container could not download Playwright's own build 1248. A clean CI run should instead do `npx playwright install --with-deps chromium` on Node 24; nothing in the tests depends on the Chromium build.

## Browser tests (`tests/browser/trainer.spec.mjs`)

All run against `dist/` served by `tools/serve.mjs` on 127.0.0.1:4187, with no retries and no sleeps. The app is deterministic, so a failure is a defect, not a flake.

1. **Keyboard-only Build mission, end to end** (C01-M02). Tab to the editor; type an invalid query (unquoted enum) and run it with `Ctrl`+`Enter`: the feedback is *Will not run* in a `role="status"` region. Replace with the correct query, run, Tab to **Check query**, Enter: *Query correct*, 60/60. Tab to the answer box, type 14, Enter: *Correct.* Tab to the radios, ArrowDown to option B, Tab to **Check call**, Enter: *Right.* The case-update card becomes visible with the authored clue, the score box says *Mission complete*, the visually hidden announcer carries the same text, the header score reads 100 / 1,970. Shift+Tab to the next-mission link and Enter navigates to C01-M03.
2. **Time-range change alters results** (C01-M01). Whole night returns 40 events. Selecting *Doors open* clears the stale table; re-running returns fewer than 40 and labels the range. Checking that narrower count as the answer yields the "your time range is narrower" warning; back on the whole night, 40 is accepted.
3. **Hint reveal.** Hints appear one at a time, the newly revealed hint receives focus, the third is a `<pre>` with the full reference, the button disappears, and the score stays at 0.
4. **Record drill-down.** 40 result rows, none carrying an ARIA role; the row's **Open record …** button opens a `region` named *Full record*, focus moves into it, the record's `metadata.id` is listed, **Close** hides it and returns focus to the opener.
5. **320 px width.** Home, chapter, mission, about, and a mission with results, open field list and a revealed hint: `scrollWidth` never exceeds `innerWidth`. The results table scrolls inside its own box.
6. **Reduced motion.** With `prefers-reduced-motion: reduce`, no element on a mission page with results has a non-zero transition or animation duration or smooth scroll behaviour.
7. **Zero CSP violations.** A `securitypolicyviolation` listener is installed before navigation. The test routes home → first mission → case file → chapter card → mission, runs, checks, reveals a hint, fixes the query, opens a record, resets, goes to About, to chapter 6, to an unknown route, toggles remembering on and off. Expected: no violations, no console errors, no page errors, requests only to `127.0.0.1:4187`, and `connect-src 'none'` still in the meta CSP.
8. **Accessibility assertions.** Every `input`, `select`, `textarea` and `button` has an accessible name; no interactive element is nested in another; no `tr` has a role or tabindex; the analyst-call list is a labelled `radiogroup`; heading levels never skip; Tab order from the editor is Run, Check, Reset, field list; the desk has four `role="status"` regions and the header score is `aria-live="polite"`; the skip link moves focus to `main` without changing the hash; the About page has its own document title.

## Accessibility pass: findings and fixes

Method: read the rendered DOM of every page type, compute contrast for every colour token against every surface it is painted on, walk the Tab order, and check what each state change does to focus and to live regions. Findings fixed in this branch:

| # | Finding | Fix |
|---|---|---|
| A1 | Skip link `href="#main"` changed the hash, so the router sent the learner to the home page | Click handler moves focus to `main` and prevents the navigation (`site/app.js`) |
| A2 | `<button>` nested inside `<a>` for all navigation buttons: two Tab stops, invalid HTML, Enter on the button did not follow the link | Replaced with `a.btn` links styled as buttons (`linkBtn` in `site/app.js`, `.btn` in `site/styles.css`) |
| A3 | Result rows were `tr role="button" tabindex="0"`, which removes the row and cell semantics for screen readers | Each row keeps table semantics and has an **Open record …** button in a new first column; the row stays clickable for mouse users (`site/ui/render.js`) |
| A4 | Revealing a hint re-rendered the button under focus, dropping focus to `body` | New hint gets `tabindex="-1"` and receives focus |
| A5 | Opening a record left focus on the table; closing it hid the focused button | Record container is a `region` with `tabindex="-1"` and receives focus; Close returns focus to the opener |
| A6 | Answer and analyst-call feedback were plain `div`s, so screen readers were not told the result | Both are `role="status" aria-live="polite"` |
| A7 | Mission completion revealed the case update in the other pane with no announcement | A visually hidden `role="status"` announcer in the desk says *Mission complete. A case update is now shown in the lesson pane.* |
| A8 | Analyst-call radios had no group label | `ul` is `role="radiogroup"` labelled by the prompt paragraph |
| A9 | `document.title` never changed across routes | Title now carries the mission, chapter or page name |
| A10 | Headings skipped from `h1` to `h3` on home and mission pages | Card headings are `h2.sub`, same visual size |
| A11 | Form-control borders used `--line` at 1.32:1 against the panel, below the 3:1 non-text minimum | New `--control: #5c6f93` (3.43:1 on the darkest panel) on textarea, select and text input; `color-scheme: dark` so native radios and checkboxes render visibly |
| A12 | Home page "People and systems" table overflowed a 320 px viewport by 62 px (nowrap first column) | Nowrap only above 480 px, `overflow-wrap: anywhere` on cells |
| A13 | Desk time-range label and select could not shrink below 301 px | Label wraps, select flexes with `min-width: 0` |
| A14 | Header could not wrap at narrow widths | `flex-wrap` on `.top` and `.topnav` |
| A15 | Editor had no programmatic link to the `Ctrl`+`Enter` hint | `aria-describedby` to the hint span |
| A16 | Reduced-motion rule only cleared transitions | Also clears animations and smooth scrolling; the site has no animations, so this is a guard |

Contrast of every text token (`--text`, `--muted`, `--accent`, `--teal`, `--ok`, `--bad`, `--warn`, `--info`) was already at or above 6.26:1 on every surface, so no text colour changed. The ratios are now asserted by `tests/unit/styles.test.mjs` (S1–S4), including a should-fail case proving the check rejects the decorative line colour and a near-background grey.

## Mutation checks

Each of these was applied, run, and reverted, to show the new tests fail for the defect they claim to catch:

| Mutation | Test that failed |
|---|---|
| Remove the skip-link click handler | Accessibility test: URL became `#main` |
| Set `style` as an attribute instead of through the CSSOM | CSP test: 40 `style-src-attr inline` violations |
| Put `role="button"` back on result rows | Drill-down test: `tr[role]` count was not 0 |
| Darken `--muted` to `#6b7280` | Unit test S1: contrast below 4.5:1 |

## Not verified

- Nothing has been compiled or executed in a Google SecOps tenant. Google's pages disagree on `condition:` in Search; chapter 6 says so.
- One browser engine (Chromium). No Firefox or WebKit run.
- No screen-reader session with a real assistive technology. The live-region and focus assertions are structural: they prove the DOM carries the right roles and that focus lands where it should, not how NVDA, JAWS or VoiceOver will read it.
- No 200% zoom test; the 320 px test covers the equivalent reflow width for a 640 px window at 200%, not browser zoom itself.
- Learning effectiveness: nobody but the builder has used it.
