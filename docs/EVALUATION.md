# Evaluation: what was tested and how

Last run 2026-10-17 on the branch that added the browser tests. Everything below is reproducible with `npm run verify`; nothing was verified by hand only unless marked.

## Summary

| Layer | Tool | Count | Result |
|---|---|---|---|
| Dataset generation | `tools/gen-data.mjs` | 1,010 events | deterministic (fixed seed), `data/events.json` unchanged by this work |
| Content validation | `tools/validate-content.mjs` | 25 missions | every reference runs; every authored answer proven against the data; every Build starter fails until completed |
| Unit tests | `node --test` | 35 | pass (29 from the first two branches + 6 for the learner-polish branch, see below) |
| Browser tests | Playwright 1.64.1, Chromium | 11 | pass (8 + 3 for the learner-polish branch) |
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

## Learner play-through and friction log

Branch `cloud/learner-polish`, 2026-10-17. Method: every one of the 25 missions was played in order through the real grader with a script (`gradeQuery`, `gradeAnswer`, `gradeCall` against `data/events.json`): the starter as shipped, two or three plausible wrong first attempts per Build and Your-turn mission, the third hint, the derived answer, and the analyst-call options. Every number quoted in the prose (times, counts, byte totals) was checked against the dataset with queries. The browser suite was then extended and the course was re-played in Chromium. The log below is written as a learner would complain, with what changed.

### Friction log

| # | Where | What a learner hits | Change |
|---|---|---|---|
| F1 | Every analyst call | The longest option was the correct one in 24 of 25 missions, and option C was correct once. A learner can pass every call without reading the prompt. | Distractors rewritten as specific, plausible analyst misreadings of similar length; correct positions now A 7 / B 8 / C 10; longest-is-correct down to 3 of 25 (two of them ties). A unit test (C7) fails the course if the longest option is correct in more than 40% of missions, any position is correct fewer than 6 times, or any option is more than 1.6 times the length of its shortest sibling. |
| F2 | 13 analyst-call prompts | The call prompt restated the value the answer box had just asked for (the IP in C01-M05, the hostname in C02-M03, the counts in C01-M03, C02-M02, C03-M03, C04-M01, C04-M02, C05-M02, C05-M03, the destination in C04-M04, the top row in C01-M04 and C05-M01). Reading one card down gave the answer away. | Prompts rephrased to refer to "the top row", "your count", "the attacker address", "a desk signed in as hal.brunner". Test C7 fails any mission whose call prompt contains its answer value, as digits or as the number word. C02-M04 still has to name both actors, so it names them without the count. |
| F3 | Build starters (C01-M03, C01-M04, C04-M02, C04-M03, C05-M02, C06-M02) | Running the untouched starter reported the `___` gap as "That aggregate is real Google syntax this trainer does not run", "That field name is not in the dataset (field: ___)" or "A comparison operator was expected". All three are false and blur the unsupported / invalid distinction the course promises. | The parser reports `STARTER_GAP` ("The starter still has a ___ gap") before any other diagnostic. Unit test G9 includes the should-fail: the same shapes without the gap keep their ordinary codes, and a lone underscore is not a gap. |
| F4 | Wrong queries, all Build and Your-turn missions | DIFFERENT_EVENTS and DIFFERENT_STATS said only "selects different events" with counts. A learner who filtered on `"FAILED"` or on `principal` instead of `target` got nothing to try next. | The comparison now carries up to three example `metadata.id` values (missing, extra, or behind a row whose numbers differ), always from the dataset side, in time order. The title says which way the result is off (misses events / returns extra events / same rows different numbers), the fix text matches, and a separate line shows the IDs and how to open one. Unit tests G10 and C6 cover the cap of three, the dataset-only source, the stats split, and the no-echo guarantee; browser test 9 types a comment into the query and asserts it never appears in the feedback. |
| F5 | C01-M03 wrong aggregate (`count` for `count_distinct`) | The table had the same single row with a different number, but the feedback said "the table differs" and listed the same IDs as both missing and extra. | Stats comparison keys rows by their grouping values: same key with different values is a "changed" row with its own message ("Same rows, different numbers: check the aggregate"). |
| F6 | Wrong answers | "Not what the whole night shows. Run the query and read the value from the results." did not say where in the results to look, so a learner who typed the row count for a `cell` answer, or a column value for a `count` answer, could not tell which. | The feedback now says where the value is read from for each check type (results bar, named column of a named row, the record behind the first row where X is Y, the time column as HH:MM) without giving the value. Browser test 9 checks a wrong count answer and asserts the value 14 is not in the hint. |
| F7 | C04-M01 concept card | The concept card stated "Sixty-two lookups", which is the answer to the mission. | Concept rewritten to teach the division (lookups per hour) without the number. |
| F8 | C02-M02 concept card | The concept card named the lookalike domain before the learner had looked for it, so the Build gap was a copy from the card. | Concept now tells the learner to open one of the portal messages and read `network.email.from`; the domain is in the record. |
| F9 | C05-M03 hint 2 | The hint contained a literal `\n` from a JSON escaping mistake, rendered as backslash-n. | Rewritten as prose. |
| F10 | C03-M03 hints | Hint 1 gave the full event type and pointed at "the concept card's field list", which does not exist; hints 2 and 3 were identical. | Hint 1 points at the Read the query card and the SCHEDULED prefix; hint 2 gives the value; hint 3 is the full query. The caveat that said "you saw it in the previous mission's data" (the previous mission filters on `-enc` and returns one row) now says how to find the schtasks launch. |
| F11 | C03-M01 hint 2 | Hint 2 of a Watch mission gave the answer count outright. | Hint 2 now directs attention to the command lines; hint 3 still gives the full reading. |
| F12 | C06-M03 concept card | The concept repeated the beat ("the anchor timestamp") instead of teaching something. | Concept is now "Four conditions, one row": stacking proven conditions until one record is left. |
| F13 | C01-M01 beat | "Do not count anything yet" was followed by an answer box asking for a count. | Beat now says do not sort or summarise yet; count what comes back. |
| F14 | C02-M04 why | The explanation leaned on "the restart he ran is in the process log" before the learner had seen a process event. | Rewritten to say chapter 3 checks it. |
| F15 | C05-M02 why | "Both rows beacon-like in count" was missing a verb. | Fixed. |
| F16 | Chapter pages | A chapter page ended with the mission list and a Next link. Nothing said what the chapter had taught. | Every chapter JSON carries a `recap` (3 to 6 plain-language lines, enforced by the validator and test C8). The chapter page shows them as "By the end of this chapter you will be able to", turning into "Chapter complete · you can now" in green once every mission is done. |
| F17 | End of course | After C06-M04 the only link was "Back to the case file". The handoff the learner had just been taught to write was never shown as a whole. | A `#closed` page lays out the C06-M04 facts, hypotheses and gaps as three columns, lists every chapter's recap, and restates what a complete course does and does not prove. Until every mission is complete it lists what is left and links to the next open mission. The home page, chapter 6 and the last mission link to it once the course is complete. |
| F18 | Top bar | The only progress indicator was a points total. A learner could not see where they were in the course without going home. | Six chapter segments in the header, each a link with a filling bar, outlined for the current chapter and green when complete, with an accessible name that reads the count. Hidden below 480 px, where the chapter cards on the home page carry the same information. |
| F19 | Editor | The only shortcut hint was Ctrl+Enter. Checking needed the mouse or two Tabs. | `Ctrl`+`Shift`+`Enter` checks on Build and Your-turn missions; the hint under the editor lists run, check and "Tab leaves the editor", and stays linked to the editor through `aria-describedby`. |

### Things the log noted and did not change

- Grading by execution means several differently shaped queries pass where the mission is teaching one shape: `user = "pledge-desk"` passes C01-M05, `target.file.full_path = /PledgeSync/` passes C03-M04 (which teaches the grouped field), `/enc/` passes C03-M02, `target.ip = "203.0.113.44"` passes C04-M02 (which teaches CIDR), and `network.sent_bytes > 10000000` without an event type passes C04-M04. This is the documented grading model (same evidence, however spelled) and was left alone; the concept cards carry the teaching.
- `file_path = /pledgesync/` fails C03-M04 with no mention of case. The new example IDs point at the records, and opening one shows the capitalised folder name, which was judged enough.
- Watch-mission third hints give the answer outright. That is the documented hint policy.
- No reference query, answer value, scoring value or dataset event changed. Analyst-call `correct` IDs changed where options were reordered; the content validator still proves every authored answer against the data.

### Fact check of quoted numbers

Every time, count and byte total quoted in beats, clues, hints and call prompts was queried: the seven pledge-desk failures 19:05:10 to 19:09:50 from 198.51.100.23 and the 19:21:04 success; Marco's three failures at 22:41, 22:42 and 22:44 from STUDIO-B with "Account disabled"; the schtasks launch at 19:35:21 one second before the 19:35:22 task event; sync.ps1 at 19:36:05, donors_export.zip at 02:05:12, segment.wav at 02:58:00 and the 03:02:15 `playout_ctl.exe --inject --slot 0310`; 62 beacons from 19:40:05 to 05:50:06; the 48,230,112-byte connection at 02:10:33; AUTOMATION-01's 48,345,375 bytes out against STUDIO-A's 1,798,232; the CDN row at 40 connections and 59,544 bytes. One mismatch found: the C04-M01 concept said the beacons spanned "ten hours and twenty minutes" (it is ten hours and ten minutes); the number is gone from the card (F7).

### New tests on this branch

Unit (all include a should-fail case): G9 starter gap; G10 example IDs for events and for stats (cap of three, dataset-only, time order, same-key rows); C6 feedback text and no-echo; C7 call guessability and prompt leaks; C8 chapter recap presence in the validator.

Browser: 9 starter gap, narrow and wide feedback with example IDs, opening a record by its ID, the `Ctrl`+`Shift`+`Enter` check, the shortcut hint, and the where-to-read answer feedback; 10 top-bar chapter progress updating as a Watch mission completes, segment links and `aria-current`, and the recap card in both states; 11 the case-closed page with nothing complete (25 missions listed, next-open link) and with every mission complete through a seeded, validated progress record (three labelled columns, the facts list, every recap green, the links from chapter 6 and the last mission, zero CSP violations). The reduced-motion test now fills a complete query because the Build starter no longer runs with its gap.

Mutation checks run and reverted on this branch: making every correct option the longest (C7 fails); removing a chapter's `recap` (C1 and C8 fail); deleting the `STARTER_GAP` check in the parser (G9 fails and browser test 9 fails on the first feedback); returning all missing IDs instead of three (G10 fails on the cap); appending the editor text to the feedback in `app.js` (browser test 9 fails on the no-echo assertion).

### Still not verified

Unchanged from the section above: no tenant execution, one browser engine, no session with a real screen reader, no browser-zoom test, and no learner outside the project. The friction log is a builder's read of the course through the grader and the browser, not a study.
