# Evaluation: what was tested and how

Last run 2026-10-18 on the density branch (49 missions). Everything below is reproducible with `npm run verify`; nothing was verified by hand only unless marked.

## Summary

| Layer | Tool | Count | Result |
|---|---|---|---|
| Dataset generation | `tools/gen-data.mjs` | 1,010 events | deterministic (fixed seed), `data/events.json` unchanged by this work |
| Content validation | `tools/validate-content.mjs` | 49 missions | every reference runs; every authored answer proven against the data; every Build starter fails until completed; every `logIt` block has a kind in the enum, a prompt, a non-empty `mustInclude`, and record IDs that exist; every chapter has 7 or more missions, at most 8 with a query desk, and two Your-turn missions (one in chapter 1) |
| Unit tests | `node --test` | 59 | pass (41 from the earlier branches + 17 for the Casebook branch + 1 for the density branch, see below) |
| Browser tests | Playwright 1.64.1, Chromium | 18 | pass (11 + 6 for the Casebook branch + 1 for the density branch), each run at the root and under `/KC7SecOpsClaude/` |
| Mutation checks on the new tests | manual, see below | 4 + 5 | each mutation failed the intended test |

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

## Casebook branch

Branch `cloud/casebook`, 2026-10-18. What a learner notices: a **Casebook** button in the top bar and `Ctrl`+`Shift`+`N`; a new first mission on how analysts keep notes; a **Log it** block at the end of every other mission worth 10 points; an **Add to Casebook** button on every open record; the last mission showing their own brief beside the authored one; and a Casebook section on the case-closed page with export buttons. The course total went from 1,970 to 2,235 points (26 missions).

### What was tested

Unit (`tests/unit/casebook.test.mjs`, `progress.test.mjs` P6, `content.test.mjs` C9, `artifact.test.mjs` A6):

| # | Claim | Should-fail cases |
|---|---|---|
| K1 | Session-only by default; remembering writes the key and turning it off removes it | — |
| K2 | Evidence numbers are stable across deletes and edits | — |
| K3 | Per-case isolation: separate entries and numbering; clearing one case leaves the other; stored cases are listed | — |
| K4 | Hostile stored state is ignored, not loaded, left in place | 16 blobs: not JSON, array, wrong version, bad case ID (`../etc`), an entry with an `onclick` key, a markup entry ID, an enum outside the set, records not an array, a string ref, duplicate IDs, negative sequence, extra key on the determination, an unknown list, a 4,001-character field, 201 pivots |
| K5 | 96 KB bound: an oversize blob is ignored; a write that would pass the bound is refused with `FULL` and the state stays intact; a small entry still fits; a 4,001-character field is `TOO_LONG`; a blank entry is `BLANK`; a bad case ID or kind is `KIND` | each listed |
| K6 | Storage that throws on every call leaves the casebook session-only | — |
| K7 | Sanitising drops unknown keys (including a `__proto__` attempt), parses refs and records from text, blanks enums outside the set, clears a blank single | — |
| N1 | A complete entry of every kind passes; the time rule accepts `HH:MM`, `HH:MM:SS` and ranges and rejects `7pm`, `24:00`, `19:5` | — |
| N2 | Claim words | *proves* without a record fails with the claim rule and the records rule; with a record it passes; *definitely*, *obviously*, *clearly*, *must have* each fail on a timeline fact with a missing ref; *proverbial* does not |
| N3 | Timeline references | a ref to a missing Evidence entry fails `BAD_REF` with the number in the message; no ref fails `NEEDS_REF` |
| N4 | Field rules | `7:05pm` fails the time rule; `evt-99999` fails as unknown record; an empty observation and confidence each fail as missing; an empty source query fails; a gap without "why" fails; a scope window `all night` fails the time rule |
| N5 | Hypotheses | supported without support, refuted without contradiction, open without a test, supported with a ref that does not exist |
| N6 | Remediation and determination without evidence refs fail `NEEDS_REF`; a verdict outside the set fails the enum rule | each listed |
| N7 | A mission's Log it passes only when an entry of the kind passes the structure check and carries every anchor; the message names the missing anchor; a remediation Log it reads only its own list and reports a structural failure before the anchors; the determination is checked as a single | no entry, partial entry, wrong list, no refs |
| N8 | Markdown and ticket export are built from the entries only, sort the timeline across midnight, carry no markup | — |
| P6 | The `cb` part takes only 0 or 10, counts in the total, a pre-casebook record still loads | `cb: 10000` refused and left in place; `cb: 7` invalid |
| C9 | All 25 original missions carry a `logIt`; the new mission has none; every kind is asked for at least once; the story anchors (C01-M05 burst and IP, C03-M03 Eradicate PledgeSync, C04-M04 Contain 203.0.113.0/24, C06-M03 determination, C06-M04 handoff) are where the spec put them | kind outside the enum, empty prompt, empty `mustInclude`, an `evt-99999` alternative, a `list` on a non-remediation kind, a mission whose anchor names a missing record, a brief mission missing a section |
| A6 | The allowlist has 14 files and each exists | — |

Browser (`tests/browser/casebook.spec.mjs`, plus the updated `trainer.spec.mjs`):

1. **Drawer.** `Ctrl`+`Shift`+`N` from the editor opens the drawer, `aria-expanded` flips, focus lands on the heading, nine tabs, Evidence selected; the desk's right edge is left of the drawer's left edge (nothing covered); `ArrowRight` and `End` move selection and focus and the panel follows; every control in the drawer has a name and nothing interactive is nested; `Escape` closes and the editor is focused again; the button toggles and **Close** returns focus to it; the shortcut is listed beside the editor's other shortcuts.
2. **Insert from results and the note check.** On C01-M05 the Log it is hidden until the query is correct, then names the evidence entry and the anchors. Opening evt-00039 and pressing **Add to Casebook** opens the drawer on Evidence with `19:05` and the ID filled, the observation empty and focused, the source showing the query and *Whole night*, and an **Edit source** button. A second record (evt-00094) turns the time into `19:05 to 19:21` and appends the ID. Writing the observation and saving yields *Passes the structure check*, the saved entry receives focus, the tab reads *Evidence, 1 entry*. **Check my Casebook** awards 10 points (`70 / 2,235`). A second entry with *proves* and no record shows both rules in plain language; a supported hypothesis without a ref shows its rule; delete is two presses.
3. **Export.** In a context with clipboard permission: a gap entry, then **Download Markdown** produces `casebook-pier-nine.md` whose content starts with the title and carries the gap and the ticket; **Copy handoff ticket** reports success and `readText()` returns the ticket; requests went only to loopback.
4. **Storage.** With remembering off, after adding a pivot `localStorage` is empty; ticking **Remember my casebook** writes exactly one key containing the pivot and leaves progress untouched; the meter is visible; unticking removes the key. A hostile blob (an entry with markup and an `onclick` key) planted before load leaves remembering off, shows *No evidence yet*, is left byte-for-byte in place, and raises no page error or dialog.
5. **320 px.** The drawer is a full-screen sheet (`aria-modal`, 320 wide at x = 0) with no horizontal overflow on any of the nine tabs, with the source editor open, with a long unbroken token saved, and after closing. Each tab is also asserted never to render the words `null` or `undefined`: a screenshot pass during the build found a literal `null` under every field without a hint (native `append` stringifies a null child), which the structural tests had not caught; it was fixed and this assertion added.
6. **Brief and case closed.** C06-M04 shows six *Yours / Model* rows, names the missions that fill an empty section, keeps its fixed-choice call, and unlocks a handoff Log it after it. Saving a determination in the drawer repaints the brief without a reload and reports the missing refs; **Assemble from casebook** fills the problem statement from it and says nothing is saved yet. The case-closed page shows the determination, says the handoff is not written with a link to C06-M04, and carries both export buttons.

Updated in `trainer.spec.mjs`: the Build mission now ends at *Log it to complete* with `Casebook 0/10` and the softer announcement; the chapter-progress test completes C01-M01 through its Scope Log it (*No scope yet* first, then the form, then *Mission complete* and `1 of 7`); the CSP test uses the labelled toggles, opens and closes the drawer, and expects the course to open on C01-M00; the case-closed test seeds `cb: 10` and expects 26 missions and `2,235 / 2,235`; desk feedback locators are scoped to `.desk` because the Log it block has its own status region.

### Mutation checks

Applied, run, reverted:

| Mutation | Test that failed |
|---|---|
| Remove the claim-word rule from `checkEntry` | N2 (no `CLAIM_WORD`) and browser test 2 (*"proves" is a claim* missing) |
| Let `validateState` accept unknown entry keys | K4 (the `onclick` blob loaded) |
| Drop the 96 KB check in `commit` | K5 (no `FULL`; bytes exceeded the bound) |
| Stop `setRemember(false)` removing the key | K1 and browser test 4 (key still present) |
| Make `cb` accept any number in `progress.js` | P6 (`cb: 10000` loaded) |

### Not verified

- Learning effect of keeping the casebook: nobody outside the project has written one.
- Quality of entries: the check is structural by design; see `docs/LIMITATIONS.md`.
- The casebook shortcut was `Ctrl`+`Shift`+`N` on this branch, which Chrome reserves for an incognito window; the density branch changed it to `Alt`+`Shift`+`C` everywhere (see below).
- Clipboard behaviour outside Chromium with permission granted; the fallback text in the Handoff tab is what a refusing browser shows.
- Same environment as before: Node 22 with an existing Chromium build, one engine, no assistive technology session.

## Density pass

Branch `cloud/density`, 2026-10-18. What a learner notices: every chapter is now seven to eleven missions long (49 in all, up from 26), with at least two Your-turn missions per chapter after the first; a **mission map** strip at the top of each chapter page (one linked segment per mission, coloured by kind and filled as it completes, with a legend); the Casebook shortcut is `Alt`+`Shift`+`C` (Chrome reserved the old `Ctrl`+`Shift`+`N`); min/max cells on a timestamp read as UTC clock times with the raw seconds beside them; and each chapter's recap lines now match what the longer chapter teaches. The course total went from 2,235 to 4,355 points. No change to `data/`, `tools/gen-data.mjs`, the engine, any existing reference query, answer value or scoring value.

### New missions, by chapter

| Chapter | New mission | Kind | Teaches | Log it |
|---|---|---|---|---|
| 1 | C01-M07 Hal spells it in capitals | Build | exact string match vs `nocase` on an account ID; zero rows is not an error | Timeline (22:41 Marco) |
| 1 | C01-M08 Same question, other role | Build | `target.user.userid != ""`: the acted-on account | Hypothesis (open) |
| 1 | C01-M09 Pivot to the playout PC | Your turn | pivot from account to host; every login on AUTOMATION-01 | Timeline (19:30) |
| 1 | C01-M10 Spot the wrong query | Read | three queries for one question; the unparenthesised OR returns 17, not 7 | Pivot |
| 2 | C02-M08 What legitimate looks like | Your turn | the real sponsor domain as a baseline | Remediation / Harden |
| 2 | C02-M05 The one the gateway caught | Watch | `security_result.action = "QUARANTINE"`: the coupon held, the lure delivered | Evidence |
| 2 | C02-M06 Anchor the start, not the end | Build | `/^Pledge Night/` (3 lures) vs `/Pledge Night$/` (2 real) vs unanchored (5) | Timeline (18:05) |
| 2 | C02-M07 Every name Hal's desk asked for | Build | group DNS by name on PLEDGE-DESK-02: seven benign names, one lookalike | Gap |
| 3 | C03-M05 Three accounts, one machine | Watch | launches per account on AUTOMATION-01: 39 / 5 / 1 | Evidence |
| 3 | C03-M06 Who launched the launcher | Build | parent (`principal.process`) vs child (`target.process`): cmd.exe → PowerShell | Timeline (19:33) |
| 3 | C03-M07 The download | Your turn | `curl.exe` and its command line, 19:36:40 | Evidence |
| 3 | C03-M08 The injection | Build | `playout_ctl.exe --inject --slot 0310`, 03:02:15 | Timeline (03:02) |
| 4 | C04-M07 A page load and a form post | Watch | the two PLEDGE-DESK-02 connections by size and direction | Timeline (18:53) |
| 4 | C04-M05 Small both ways | Build | `network.sent_bytes < 1000`: 62 beacons, three outliers | Evidence |
| 4 | C04-M06 Either end, in one token | Build | grouped field `ip` vs explicit OR; the CDN at 74 connections from seven hosts | Remediation / Harden |
| 4 | C04-M08 Beacons by the hour | Your turn | `by 1h`: six per hour, seven in the 02:00 hour | Hypothesis (supported) |
| 5 | C05-M04 First and last | Build | `min`/`max` on `metadata.event_timestamp.seconds`, answered as HH:MM | Timeline (05:50) |
| 5 | C05-M05 The quiet end of the list | Build | `asc` vs `desc` and what `limit` then keeps | Gap |
| 5 | C05-M06 Three numbers per destination | Watch | three outcomes per row: count, count_distinct, sum | Evidence |
| 5 | C05-M07 How many, how many different | Your turn | `count` 102 vs `count_distinct` 2 on the same field | Remediation / Recover |
| 6 | C06-M05 Failures by the hour | Build | `by 1h` on all FAIL logins: 8 / 4 / 1 / 1 | Evidence |
| 6 | C06-M06 Everything from one address | Your turn | one key, no event type: 8 logins, no other event type | Timeline (19:21) |
| 6 | C06-M07 Contain, eradicate, recover, harden | Read | the four lists with evidence refs and their order | Remediation / Recover |

Kinds across the course: 10 Watch, 22 Build, 12 Your turn, 5 Read. Log it kinds added: 8 Timeline, 6 Remediation (3 Harden, 2 Recover, beside the existing Contain and Eradicate items), 5 Evidence, 2 Hypothesis, 2 Gap, 1 Pivot. Timeline and Remediation were the under-fed tabs (2 and 4 missions) and now have 10 and 8 missions feeding them.

### Method

Every candidate reference was run against `data/events.json` before a word was written, and every number in a beat, clue, hint or call prompt was taken from those rows. Each new mission was then played through the real grader with a script (`gradeQuery`, `gradeAnswer`, `gradeCall`): the starter as shipped (every Build starter reports its `___` gap), two or three plausible wrong attempts, the third hint (passes on every Build and Your-turn mission), the derived answer and its accepted alternatives, the correct and a wrong analyst call, and whether the Log it prompt or clue names every token the check will demand. Three new missions were then played in Chromium (browser test 18): C05-M04 end to end with the clock-time cells, C01-M10 as a Read mission, and C06-M06 with a too-narrow query first.

### Friction log

| # | Where | What a learner would say | What changed |
|---|---|---|---|
| D1 | C01-M09 call prompt | The prompt said "the first minute after 19:30", which is the answer the box had just asked for. | Reworded; test C7 (prompt must not restate the answer) now covers 49 missions and passes. |
| D2 | C05-M04 results table | `$first` and `$last` showed as `1,773,430,805`; nobody reads a brief in epoch seconds. | Outcomes computed as `min`/`max` on `metadata.event_timestamp.seconds` render as `03-13 19:40:05 (1773430805)`; the answer check gained `format: "hhmm"` so the validator derives `19:40` from the cell. A plain `sum` column still renders as a number (browser test 18). |
| D3 | C06-M05 | Typing `by 1 h` with a space is reported as *The time window after by is not valid*. | Left alone; the message names the window and the hint says "no space". |
| D4 | C03-M06 | A path pattern typed with one backslash before `cmd` instead of two runs and *misses events* with example IDs, but nothing says the backslash count is why. | Left alone; C03-M01's caveat ("count the backslashes first") is two missions earlier. Candidate for an engine hint in session 3. |
| D5 | Chapter pages | With eleven missions in chapter 1 the list alone no longer showed where you were. | The mission map strip: 11 linked segments on chapter 1, kinds in a legend, `done`/`partial` states, accessible names that read "Mission 2, Open the login log, Watch one, complete". |
| D6 | Several Build missions | As before, differently shaped queries pass by execution: `"marco.vela"` in lower case passes the `nocase` mission, `target.ip = "192.0.2.120"` passes the grouped-field mission (the CDN is only ever a target), `/0310/` on the command line passes the injection mission, `over every 1h` passes the `by 1h` mission. | Documented grading model; the concept cards carry the teaching. |
| D7 | Spec vs chapter 1 | The brief asked for 7 to 8 missions per chapter and four additions to chapter 1, which make eleven. | The validator rule counts desk missions (Watch, Build, Your turn) against the ceiling of 8 and leaves Read missions, which have no desk, outside it; chapter 1's three Read missions frame the chapter. Minimum 7 in total. Test C10 proves the thin, fat and no-Your-turn cases fail. |

### Left for session 3

- A timestamp helper (`timestamp.get_hour` and friends) would let C05-M04 ask for the hour directly; the engine reports those functions as unsupported, so the mission reads the clock from the formatted cell instead.
- `dedup`, arrays and multi-event joins are still unsupported and no new mission depends on them.

### Not verified

- Learning effect of the longer chapters: nobody outside the project has played the 49-mission course.
- `Alt`+`Shift`+`C` on Windows layouts where `Alt`+`Shift` switches input language, and on macOS layouts where it types a character; the handler matches the physical key, and the button remains the fallback.
