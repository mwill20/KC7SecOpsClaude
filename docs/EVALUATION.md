# Evaluation: what was tested and how

Last run 2026-10-19 on the session-5 branch `cloud/s5` (101 missions, three cases, twelve chapters). Everything below is reproducible with `npm run verify`; nothing was verified by hand only unless marked. The session-3, session-4 and session-5 sections are at the end of this file; the summary table is the session-5 run.

## Summary

| Layer | Tool | Count | Result |
|---|---|---|---|
| Dataset generation | `tools/gen-data.mjs` | 1,010 + 973 + 675 events | deterministic (fixed seeds); `data/events.json` and `data/events-week-after.json` byte-identical to session 4 (digests `a2ddb67f…` and `c7b7e9ef…` unchanged in `content/case.json`); `data/events-saltmarsh.json` new (digest `748f83d4…`) |
| Content validation | `tools/validate-content.mjs` | 101 missions, 3 cases, 5 lists, 4 tables, 42 entity records in 2 directories | every reference runs against its case's data and directory (Search or rule); every authored answer proven; every Build starter fails and every hint 3 passes in the mission's mode; every `logIt` block valid, with record ids that exist and are returned by the mission's reference; every rule mission's reference passes its own must-fire and must-not-fire cases; density rule per chapter; each case's window, ranges, chapters, directory file, bridge and digest; every case fed from Scope to Handoff with a brief mission last |
| Unit tests | `node --test` | 82 | pass (74 before + R1 to R4 rule mode (four tests) + C14 the third case + C15 rule missions; C9 gained the drifted-id case) |
| Browser tests | Playwright 1.64.1, Chromium | 27 | pass (25 before + rule mode on the desk + the third case and its bridge), each run at the root and under `/KC7SecOpsClaude/` |
| Mutation checks on the new tests | manual, see below | 4 + 5 + 5 + 7 + 10 | each mutation failed the intended test, except one redundant validator line that was removed and replaced by a test (session 5) |

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

## Session 3: the Casebook additions, engine v2 and the week after

Branch `claude/tender-euler-3gssj3` (the task named it `cloud/s3`), 2026-10-18. What a learner notices: the Casebook opens on an **investigation name** field and has a **FreeForm** tab between Scope and Evidence (a blank page with a faded template, Insert template, text-only paste, a 24 KB meter, a presence-only structure check; ungraded, and the notes mission says when to use it); the desk accepts `dedup`, `array`/`array_distinct`, `earliest`/`latest`, the UTC time functions, the string functions and reference lists, and carries a **Lists** panel; a non-UTC zone is reported as *not run here* with the reason; the home page has a **case switcher** and a second case, **The week after**, with chapters 7 and 8, its own window and ranges, its own casebook and its own case-closed page. The course total went from 4,355 to 5,620 points. No change to any chapter 1 to 6 reference query, answer value or scoring value; `data/events.json` is byte-identical.

### New missions, by chapter

| Chapter | Mission | Kind | Teaches | Log it |
|---|---|---|---|---|
| 7 | C07-M01 The week after | Read | a new case gets a new Scope; "did the fix hold" has two halves | Scope |
| 7 | C07-M02 One row per account at the gateway | Watch | `dedup:` on an event query lists, does not count: three accounts | Evidence (20:03, evt-20200) |
| 7 | C07-M03 Every address an account used | Build | `array_distinct(principal.ip)` per account; Lena's desk, outside and gateway-assigned addresses | Evidence |
| 7 | C07-M04 First and last sighting | Build | `earliest`/`latest(metadata.event_timestamp)` on the grouped `ip`; 19:12 to 05:49 | Timeline (19:12) |
| 7 | C07-M05 The small hours | Watch | `timestamp.get_hour(…, "UTC") < 6` at the gateway; off-hours is a station claim | Hypothesis (open) |
| 7 | C07-M06 First seen, per pair | Your turn | account-and-address pairs with `earliest`, ordered: the first-seen table | Evidence (20:11, evt-20210) |
| 7 | C07-M07 The cadence by hour | Your turn | `$h = timestamp.get_hour(…)` as a match key; ten hours, four each | Pivot (FS-01) |
| 7 | C07-M08 Where the session went | Build | `dedup: target.ip`: three destinations, one BLOCK | Gap (FS-01) |
| 8 | C08-M01 Everything but the sponsors | Watch | `not in %sponsor_domains`: two lookalike names survive | Evidence (evt-20135) |
| 8 | C08-M02 The shape of a lookalike | Build | `in regex %lookalike_patterns`; the allowlist admitted last week's lure | Evidence (18:35, evt-20051) |
| 8 | C08-M03 Who may run as another user | Build | `not in %admin_accounts` on run-as attempts: one denied at 02:31 | Timeline (02:31) |
| 8 | C08-M04 Did the block hold? | Watch | `in cidr %blocked_ranges`: one BLOCK, the control refusing | Evidence (20:20, BLOCK) |
| 8 | C08-M05 Outside addresses, with names | Your turn | `array_distinct` of accounts per outside address | Hypothesis (supported) |
| 8 | C08-M06 The block that would be too wide | Your turn | `net.ip_in_range_cidr` + `dedup`: four accounts in the range Hal wants blocked | Remediation / Contain |
| 8 | C08-M07 Did the fix hold? | Read | held item by item, too narrow where it was not applied; four lists | Determination |
| 8 | C08-M08 Handoff, week two | Read (brief) | the second handoff beside the model | Handoff |

Kinds added: 4 Watch, 5 Build, 4 Your turn, 3 Read. Points: 675 in chapter 7, 590 in chapter 8. Chapter 7 feeds Scope, Evidence (3), Timeline, Hypothesis, Pivot and Gap; chapter 8 feeds Evidence (3), Timeline, Hypothesis, Remediation (Contain), Determination and Handoff, so the second casebook fills from Scope to Handoff and the validator now requires that of every case.

### Method

The second window was generated first (`tools/gen-data.mjs`, seed 20260320, appended after the case-1 generation so no case-1 byte moves; `sha256sum data/events.json` before and after is `3c2da175f2880c4c…`). Every candidate chapter-7 and chapter-8 query was run against `data/events-week-after.json` through the real engine before a word was written, and every number, time and record ID in a beat, clue, hint or Log it prompt was taken from those rows. The engine v2 pages were checked against Google's documentation through search summaries (the container's proxy refuses `docs.cloud.google.com`); the URLs are in `site/engine/catalog.js` and on the About page, and the summaries are quoted in the PR. Each new construct got a passing case and a should-fail case in `tests/unit/engine.test.mjs` (V1 to V4) before the content used it. The chapters were then played through Chromium (browser cases test): C07-M02 end to end into the week-after casebook with a case-1 record ID refused, C08-M02 graded by execution, both closed pages.

### Friction log

| # | Where | What a learner would say | What changed |
|---|---|---|---|
| S1 | Name field and FreeForm page | Typing one character and losing it: the drawer repainted on every store change and replaced the input under the cursor. | Saves from the two typed fields run with the repaint suppressed; everything else still repaints. Browser FreeForm test 1 types a sentence and checks the value. |
| S2 | Scope tab | The Scope passed the structure check without a name, so the "first field" was optional in practice. | `NEEDS_NAME` on the Scope check when the casebook has no name; the Log it for the Scope fails with *Name the investigation in the field at the top of the Casebook.* (tests F1, N4; browser name test). |
| S3 | FreeForm structure check | "A query line" was going to mean any line with `=`, which a timeline note like `DATE-TIME (UTC): 19:05` does not have, but `HYPOTHESIS: x = y` does. | Kept simple and said so: a line containing `=` or a section keyword counts. The check reports presence only and the UI says it is ungraded (test F4). |
| S4 | C08-M02 call prompt | *The block held* in the prompt for the BLOCK answer; the leak check reads `block` as the answer, case-insensitively, and it is right to. | Reworded as *The gateway refused the range*; five other new prompts had restated a count, a time or a name and were reworded the same way (test C7). |
| S5 | Chapters 7 and 8 record IDs | Moving one benign session inside the window (a failed first try at −60 s fell before 18:00) shifted every later case-2 ID by one, and the validator did not mind because the shifted IDs still exist. | IDs are resolved by time and type from the data and re-cited; `LIMITATIONS.md` names the gap (an existing-but-wrong ID is invisible to the validator). Candidate for session 4: `mustInclude` IDs checked against the reference query's own rows. |
| S6 | `dedup` placement | Google's example dedups after outcomes and orders by an outcome; the task's should-fail list named "dedup without match", which the docs allow on a plain event query. | Followed the docs: `dedup` is accepted between `condition` and `order`, keeps the first row per key after ordering, and on a summary table may name only match keys or outcomes (`DEDUP_KEY_NOT_GROUPED`). Said so in `LIMITATIONS.md`. |
| S7 | Time zones | `timestamp.get_hour(ts, "America/Los_Angeles")` is valid Google syntax; silently running it as UTC would teach a wrong hour. | Reported as *not run here* with the zone named and the reason (the dataset is read in UTC); `"UTC"`, `"GMT"` and the omitted argument run (test V3; browser engine test). |
| S8 | Browser suite | One run reported a console 404 in the CSP test that did not recur in four later runs of the same build; the container's egress proxy was refusing a Chromium component host at the time. | Left alone and recorded here. The test asserts loopback-only requests, which held. |
| S9 | Home page | With two cases the single "Open the case" button and "N of 49" line no longer said which case. | A case switcher (two linked tabs with accessible names), per-case counts beside the course count, per-case chapter grid, people and casebook card; `#case/week-after` and `#closed/week-after` routes; `#closed` stays the first case's. |
| S10 | Lists panel | A learner who had never seen a tenant would read the bundled lists as the product. | The panel, the About page, chapter 8 and the list descriptions say lists live under Detection > Lists and that the trainer bundles them; `sponsor_domains` says in its own description that it was written in a hurry. |

### Mutation checks

| Mutation | Test that failed |
|---|---|
| `dedup` keeps the last row per key instead of the first | V1 (and C1, because C07-M02's authored answer no longer derives) |
| The digest comparison removed from `validateCase` | C12 |
| FreeForm text truncated at 24 KB instead of refused | F2 |
| Any time zone accepted by the parser | V3 |
| The Scope check no longer requires the name | N1, N4, F1 |

### Left for session 4

- Multi-event joins and entity context (chapters 9 and 10) as planned; the case model is a `cases` array with per-case windows, ranges, datasets and casebooks, so a third case is a new entry, a new data file and new chapters.
- `mustInclude` record IDs checked against the mission's reference rows, not only for existence (S5).
- An engine hint for the backslash count (D4 from the density pass) is still open.

### Not verified

- Tenant execution of any engine v2 shape; the Google pages were read through search summaries, not fetched.
- Learning effect of the second case: nobody outside the project has played it.
- The second case's data on a thirty-day baseline, which the chapters mention and the trainer does not have.

## Session 4: data tables, joins, entity context, chapters 9 and 10

Branch `claude/quirky-clarke-qo2yj0` (the task named it `cloud/s4`), 2026-10-18. What a learner notices: the desk panel is **Lists and tables** and shows four data tables (with a `source` column on the allowlist that says which rows came from the week-one mail log) beside the five legacy lists, with the July 2027 retirement date; chapter 8 opens with a Read mission on the migration and three of its missions name a `%table.column`; a query with two event variables runs as a **join** and the results bar says `joined $e1 and $e2 within 1h`; an **Entities** panel lists the station directory's fields and an entity query renders records with their validity interval; two new chapters in the second case, **Two events, one story** and **Who owns this host**; the week-two handoff moved to the end of chapter 10 with owners on every Remediation line. The course total went from 5,620 to 6,970 points over 82 missions. No change to any chapter 1 to 7 reference query, answer value or scoring value; chapter 8 kept its mission IDs; `data/events.json` is byte-identical.

### Documentation, as verified by the owner

The build container cannot reach `docs.cloud.google.com`. The owner read the pages on 2026-10-18 and the engine follows these facts, recorded in `site/engine/catalog.js` (`DOCS`) and on the About page:

- **Reference lists** (`/chronicle/docs/reference/reference-lists`): replaced by data tables; existing lists are migrated automatically; legacy reference lists retire in July 2027.
- **Use reference lists and data tables in YARA-L 2.0** (`/chronicle/docs/yara-l/reference-list-syntax`): STRING `field in %list`, REGEX `field in regex %list`, CIDR `field in cidr %list`; data tables use the same three forms with `%table_name.column_name`; `not` and `nocase` combine with them (`nocase` for STRING and REGEX only); Search limits per query: at most 7 `in` statements, 4 with `regex`, 2 with `cidr` (rules: 10/5/5); lists are usable in the events and outcome sections; string lists are exact and case-sensitive by default; list files support `//` comments.
- **timestamp.get_hour** (`/chronicle/docs/detection/yara-l-2-0-functions/timestamp-get_hour`): the zone defaults to GMT and accepts TZ names, offsets, `"UTC"` and `"GMT"`.
- **Deduplicate search results** (`/chronicle/docs/investigation/deduplication-yaral`): `dedup` after `match`/`outcome` on aggregated queries, keyed by match or outcome fields; on plain queries any non-repeated, non-grouped field or placeholder; placed before `order` in every example.
- **Use conditions in search and dashboards** (`/chronicle/docs/investigation/yara-l-2-0-conditions`): Search queries with two event variables joined by a shared placeholder (`$e1.principal.hostname = $hostname`, `$e2.principal.hostname = $hostname`, `match: $hostname over 1h`, `condition: #e1 > 0 or #e2 > 1`); `#var` is the count of distinct occurrences, `$var` is `#var > 0`; bounded against unbounded conditions; a non-existence condition needs at least one bounded event.
- **Analyze search data with statistics**: the `over` keyword used for event-window searches is not supported in Search, and Search has no condition section, which contradicts the conditions page; entity data is queried with `graph.entity.*` fields (`graph.entity.hostname != ""`, `match: graph.entity.ip by hour`, `outcome: $min_seconds = min(graph.metadata.event_metadata.event_timestamp.seconds)`); entity records are valid over a time range, with `by first hour` restricting to the start time.

The trainer follows the conditions page for joins and says so to the learner (C09-M01, LIMITATIONS); it does not implement `by first hour`.

### New missions, by chapter

| Chapter | Mission | Kind | Teaches | Log it |
|---|---|---|---|---|
| 8 | C08-M00 The lists are moving | Read | what changes when a list becomes a table (home, `%table.column`, columns), what does not (the three forms, `not`, `nocase`, the 7/4/2 limits), July 2027 | Remediation / Harden (2027, source) |
| 8 | C08-M02 (rewritten) | Build | `in regex %lookalike_shapes.pattern` | Evidence (18:35, evt-20051) |
| 8 | C08-M03 (rewritten) | Build | `not in %privileged_accounts.account` | Timeline (02:31) |
| 8 | C08-M04 (rewritten) | Watch | `in cidr %gateway_blocks.range` | Evidence (20:20, BLOCK) |
| 8 | C08-M08 (no longer the brief) | Read | the first version of the week-two handoff | Handoff |
| 9 | C09-M01 Correlation or coincidence | Read | a join is a claim with a key and a window; the documentation conflict on `over` | Gap (over) |
| 9 | C09-M02 The gateway and the file server | Watch | two variables, `$account`, `over 1h`, `earliest()` per side: 20:03 then 20:11 | Evidence (evt-20200, evt-20210) |
| 9 | C09-M03 Login, then a file | Build | the window as a distance, `earliest()` as direction: Lena's export after the login, Odalys's spreadsheet before hers | Timeline (02:52) |
| 9 | C09-M04 The lookup and the connection | Build | the key as an address, a table column on one side of a join, `over 5m`: 1 and 40 pairs | Hypothesis (supported) |
| 9 | C09-M05 The join that finds the engineer | Your turn | the same shape returns Dez's ALLOW and the attacker's FAIL; the action column decides | Evidence (21:05, evt-20298) |
| 9 | C09-M06 More than once | Build | `condition: #e2 > 1`; why `#e2 = 0` is not run here | Gap (FS-01) |
| 9 | C09-M07 Two doors, one account | Your turn | both sides the same event type: desk 18:20 and gateway 20:03 within 2h | Pivot (PLEDGE-DESK-01) |
| 9 | C09-M08 Give it the whole night | Watch | `over 12h` returns everyone: the wide window is the baseline | Evidence (23:23, evt-20398) |
| 10 | C10-M01 Context is a second dataset | Read | entity records with validity intervals; the join form documented for rules | Gap (directory) |
| 10 | C10-M02 Every host and its owner | Watch | `graph.metadata.entity_type = "ASSET"`: eleven records, FS-01 owned by odalys.reyes | Pivot (FS-01) |
| 10 | C10-M03 Accounts the station let go | Build | `employment_status = "TERMINATED"`; the directory lagged on pledge night | Gap (marco.vela) |
| 10 | C10-M04 A terminated account in the login log | Build | `$e.principal.user.userid = $uid` with `$u.graph.entity.user.userid = $uid`: two FAIL from STUDIO-B at 23:50 | Remediation / Harden (STUDIO-B, owner kenji.mori) |
| 10 | C10-M05 Title against privilege, with the directory | Your turn | run-as attempts with title and role: STATION_ADMIN ALLOW, MEMBERSHIP_SHARE_EDITOR FAIL | Hypothesis (supported) |
| 10 | C10-M06 Where the session went, with owners | Build | connections joined to assets on the address: the outside drops out, FS-01 HIGH stays | Timeline (20:11, HIGH) |
| 10 | C10-M07 Which findings change | Your turn | gateway successes joined to `remote_access = "no"`: the same finding on a record | Determination (updated) |
| 10 | C10-M08 Handoff, with owners | Read (brief) | the final ticket beside the model | Handoff |

Kinds added: 4 Watch, 5 Build, 4 Your turn, 4 Read (one of them the Read added to chapter 8). Points: chapter 8 590 → 615, chapter 9 675, chapter 10 650; case 2 1,265 → 2,615.

### Method

Every candidate join and entity query was run against `data/events-week-after.json` and the bundled directory through the real engine before a word was written (the probe scripts ran `runQuery` with the case-2 context), and every number, time and record ID in a beat, clue, hint or Log it prompt was taken from those rows. The two appended case-2 records were given ids after the existing ones were fixed (`evt-20972`, `evt-20973`), so every chapter 7 and 8 citation is unchanged; the validator proves every chapter 7 and 8 answer against the regenerated file and the new digest is recorded in `content/case.json`. Each new engine construct got a passing case and a should-fail case in `tests/unit/engine.test.mjs` (V5 to V7) before the content used it. The desk was then driven in Chromium (`tests/browser/entities.spec.mjs`): the Entities panel, a terminated-user query rendered with its interval, an open entity record, the event-to-entity join as a table with its join column, a two-event join labelled with its window, and three should-fail messages.

### Friction log

| # | Where | What a learner would say | What changed |
|---|---|---|---|
| J1 | Direct join `$e1.a = $e2.b` | The only way to name the key in `match:` was a placeholder, so a join written the way rules often write it had nothing to group by. | Either side of a direct join may be named in `match:` and resolves to the join key (V6). |
| J2 | Joins on blank fields | A blank hostname on a remote session paired with every other blank hostname, and an asset record paired with an event on the user field it does not carry. | Zero values never join, as Google's match variables skip them unless `allow_zero_values` is set; V6 and V7 assert it and LIMITATIONS says so. |
| J3 | `count(metadata.id)` in a join | Refused as an outcome without a variable, which is right, but the message had to say how to fix it. | `OUTCOME_NEEDS_VARIABLE`: write `count($e1.metadata.id)`. Entity queries may still count `metadata.id`, since every record has one. |
| J4 | `#e2 = 0` | The natural way to ask "gateway accounts that never touched the file server" is a non-existence test, which the join cannot answer. | Reported as *not run here* with Google's reason (a condition needs a bounded event); C09-M06 teaches it and its call asks why. |
| J5 | Entity join columns | A join column was named after the placeholder in the first draft, so two learners' tables could not be compared. | Join columns are named by the fields joined, sorted (`graph.entity.user.userid = principal.user.userid`); outcome names stay the learner's. |
| J6 | Analyst calls in chapters 9 and 10 | The first draft's correct options were the longest in fifteen of sixteen missions. | Distractors lengthened or the correct option trimmed until test C7 passed: longest-is-correct in 22 of 82 missions, every option within 1.6× of its shortest sibling. |
| J7 | Entities panel | Its `details` shared the field list's class, so the browser test that opens the field list found two panels. | Own class and styles; the full suite passes at the root and under the subpath. |
| J8 | Chapter 8's brief | With chapters 9 and 10 in the case, the week-two handoff could no longer be the last mission. | C08-M08 keeps its ID and asks for the first version of the handoff; C10-M08 is the brief mission and the case-closed page reads it. |

### Mutation checks

Applied, run, reverted:

| Mutation | Test that failed |
|---|---|
| Join keys no longer skip zero values | V6 (the blank account pairs) and V7 (an asset joins an event on the user field) |
| Entity join ignores the validity interval | V7 (bo joins both versions) |
| The regex list limit removed from the parser | V5 (five `in regex` tests accepted) |
| `over N` accepted on a single-event query | G3 and V6 should-fail (`OVER_WINDOW` no longer raised) |
| Non-existence conditions accepted | V6 should-fail (`#e2 = 0` runs) |
| The `over` window ignored in the executor | V6 (the one-minute join returns a row) and C1 (C09-M08's authored answer no longer derives) |
| Overlapping entity versions accepted by the validator | C13 |

### Left for session 5

- Detection-rule literacy: the chapter 9 and 10 joins written as rules, with `allow_zero_values`, the rule-engine data-table join (`field = %table.column`) and non-existence conditions, which this trainer reports as not run here.
- A third, smaller case (chapters 11 and 12), as planned.
- `mustInclude` record IDs checked against the mission's reference rows (S5 from session 3) is still open; entity ids are now accepted by existence as event ids are.
- Three-way joins and `by first hour` on entity queries are not implemented.

### Not verified

- Tenant execution of any join or entity shape; Google's own pages disagree on `over` in Search and the trainer follows the conditions page.
- The entity field names against a tenant's entity graph: they mirror UDM entity nouns as the team reads them, and the roles, criticality and remote_access values are the station's own labels.
- Learning effect of the two new chapters: nobody outside the project has played them.
- Same environment as before: Node 22 with an existing Chromium build (1194) through `PIER9_CHROMIUM`, one engine, no assistive technology session.

## Session 5: rule mode, chapter 11, the third case and chapter 12

Branch `cloud/s5`, 2026-10-19. What a learner notices: a **Mode** switch beside the time range on every desk, with **Search** and **Rule**; chapter 11, **From search to detection**, in the second case, whose missions start in Rule mode, show a **Test cases** card beside the question (must fire: a key and a minute; must not fire: a key), return **detections** with window start and end instead of rows, and grade a rule by those two cases with the false positives counted in the feedback; a third case, **A different pier**, on the home page's case switcher, with its own people, directory, time ranges and a chapter whose desk missions carry the question, three hints and the Log it and nothing else; and, once that case is complete, a **Cybersecurity Engineering bridge** on its case-closed page. The course total went from 6,970 to 8,600 points over 101 missions. No chapter 1 to 10 reference query, answer value or scoring value changed; two Log it record ids were corrected (below); `data/events.json` and `data/events-week-after.json` are byte-identical.

### Documentation, as verified by the owner's reviewer

The build container cannot reach `docs.cloud.google.com`. The owner's reviewer read the pages on 2026-10-18 and the facts below are recorded as authoritative in `site/engine/catalog.js`, chapter 11 and the About page:

- A YARA-L 2.0 rule has the shape `rule name { meta: ... events: ... match: $key over 1h  outcome: ... condition: ... }`.
- In rules every field is written with an event variable (`$e.metadata.event_type`); `match` uses `over N`, a sliding window; `condition` is mandatory.
- **UDM search compared with rule results**: Search and rules run on different engines, evaluate different time windows and handle repeated fields and deduplication differently, so counts differ.
- Match variables skip zero values unless `allow_zero_values` is set in `options`.
- The rule-engine data-table join form is `$e.field = %table.column`; reference lists and tables are usable in `events` and `outcome`.

The trainer runs a subset of this (LIMITATIONS lists what it does not run) and models the sliding window as: per match key, a window opens at the first unconsumed event and covers `[t0, t0 + N]`; if the condition holds on the events inside it they are one detection and the window moves past them; otherwise it moves to the next event. Severity is restricted to LOW, MEDIUM, HIGH and CRITICAL to teach the habit; Google's `meta` is free text and the caveat on C11-M04 says so.

### New missions, by chapter

| Chapter | Mission | Kind | Teaches | Log it |
|---|---|---|---|---|
| 11 | C11-M01 A query answers once; a rule keeps answering | Read | the envelope, the variable, the window, the condition; the two engines; must-fire and must-not-fire | Gap (engine, tenant) |
| 11 | C11-M02 The burst, as a rule | Watch (rule) | the chapter 6 bucket query as a rule at `>= 2`; a threshold is a memory of the last attack; 2 detections (pledge-desk 19:58, marco.vela 23:50) | Evidence (evt-20189, evt-20190, 19:58) |
| 11 | C11-M03 Login, then a file, as a rule | Build (rule) | the chapter 9 join as a rule, `condition: $e1 and $e2`; Odalys's desk-then-home pair as a counted false positive | Pivot (thirty days, the workstation class) |
| 11 | C11-M04 Say it to the SOC | Build (rule) | `meta`: author, description, severity as communication; the gap is the severity | Remediation / Harden (HIGH, evt-20863) |
| 11 | C11-M05 The blank hostname | Build (rule) | `allow_zero_values`: a rule keyed on the gateway's blank hostname is silent until the option is set | Gap (allow_zero_values, hostname) |
| 11 | C11-M06 A table inside a rule | Your turn (rule) | `$e.principal.user.userid = %privileged_accounts.account`, outcomes reading `%privileged_accounts.may_run_as` and `granted_by`; a LOW review rule | Evidence (evt-20294, dez.okafor, odalys.reyes) |
| 11 | C11-M07 Tuning: the engineer's maintenance | Your turn (rule) | the noisy run-as rule in the question; tune through `not ... in %privileged_accounts.account`, not a name; Dez must not fire | Hypothesis (supported; privileged_accounts, evt-20796) |
| 11 | C11-M08 Same data, two counts | Watch (rule) | `over 3m` returns 2 detections where Search `by 3m` returns 1 row (marco.vela straddles a clock boundary); the Mode switch shows both | Gap (bucket versus sliding) |
| 11 | C11-M09 Deploy, replay, approve | Read (brief) | replay, severity and owner, who approves; the detection handoff with each rule's two cases beside the model | Handoff (evt-20863, must not, replay) |
| 12 | C12-M01 Which hosts installed the update | Your turn | scope before suspect; three installer launches at 09:30 | Scope (Marguerite Doyle, 06:00, 16:00) |
| 12 | C12-M02 What the installer left behind | Your turn | the plugin launched by the signed client at 09:31 on three hosts | Evidence (evt-30165, tw-telemetry) |
| 12 | C12-M03 Persistence | Your turn | three `TideWatchTelemetry` tasks about a hundred seconds after each installer | Timeline (09:31, TideWatchTelemetry) |
| 12 | C12-M04 Where it talks, and how often | Your turn | per-host cadence to 198.51.100.210: 21, 20 and 20 connections; one host sent more | Hypothesis (open; 198.51.100.210, svc-tidewatch) |
| 12 | C12-M05 The deckhand's morning | Build | `latest()` as the gap; rafael.quinn's account ends at 08:40 and never returns | Pivot (rafael.quinn, 08:40) |
| 12 | C12-M06 What the service account wrote | Your turn | three files, the archive m.zip at 13:06 after a hidden `Compress-Archive` of the manifests share | Evidence (evt-30458, m.zip) |
| 12 | C12-M07 What left the pier | Build | `network.sent_bytes > 1000000`: 2,814,400 bytes to the beacon's destination at 13:20 | Gap (198.51.100.210, the archive's contents) |
| 12 | C12-M08 The detection | Your turn (rule) | a host connecting more than once in an hour on port 8443, keyed by host; must fire DISPATCH-01 09:32, must not fire OFFICE-02; 18 detections | Remediation / Contain (198.51.100.210, TideWatchTelemetry) |
| 12 | C12-M09 Determination | Read | confirmed incident, high confidence, the person cleared in the same sentence; the model in the case update | Determination |
| 12 | C12-M10 Handoff, for an engineer | Read (brief) | the ticket beside the model; the bridge on the closed page | Handoff (DISPATCH-01, TideWatch, FS-GULL) |

Kinds added: 3 Watch, 5 Build, 8 Your turn, 3 Read. Points: chapter 11 700, chapter 12 930; case 2 2,615 → 3,315; case 3 930; course 6,970 → 8,600.

### Method

Every rule and query in chapters 11 and 12 was run through the real engine against its case's data before a word of prose was written (the probe scripts ran `runRule` and `runQuery` with the case context); every number, time and record id in a beat, clue, hint, test case or Log it prompt was taken from those rows and detections. The validator then proved them again: each rule reference against its own must-fire and must-not-fire cases, each answer derived from detections or rows, each Build starter failing and each hint 3 passing in the mission's mode, and each Log it record id among the reference's rows. Each new engine construct got a passing case and a should-fail case in `tests/unit/rules.test.mjs` before the content used it. The desk was then driven in Chromium (`tests/browser/rules.spec.mjs`, `capstone.spec.mjs`): the Mode switch, the Test cases card, detections with their window columns, a Build rule failing the must-not-fire case with the false-positive count and then passing, the rule messages, the Search count on the same data, the third case's directory and casebook, a capstone mission without explained parts, and the bridge once the case is complete.

### Friction log

| # | Where | What a learner would say | What changed |
|---|---|---|---|
| R1 | C11-M02 | "The chapter 6 rule says > 3 and tonight nothing fires; is the rule broken?" | The Watch rule is written at `>= 2` and the concept says why: a threshold tuned to last week's burst sleeps through this week's two quiet tries. The tuning mission closes the loop. |
| R2 | The rule executor's first draft | A two-minute window from the first failure held only two of ana's four failures in the unit data, and the test expected three. | The test was wrong, not the executor: 0, 70 and 130 seconds span more than 120. The expectation now shows the slide (the window that fires opens at the second failure), and R1 documents it. |
| R3 | `match: $a` with no window in a rule | Reported as "wrong window form", which pointed at `by`. | A key without any window now reads `RULE_NEEDS_WINDOW`: write `match: $account over 5m`. |
| R4 | `order:` inside a rule | The section was swallowed into `condition` and reported as a section-order problem. | The section splitter leaves unknown words to the body parser, which names them: `RULE_NO_SECTION`, dedup, order and limit belong to Search. |
| R5 | A doubled `}` | Reported as an unexpected token at the end. | `RULE_BRACE`. |
| R6 | C11 and C12 analyst calls | The first draft's correct options were the longest in every chapter 11 mission and all sat at B; three prompts restated their answers ("two", "twenty", "08:40", "13:06", "eighteen"). | Test C7 caught each one: options rebalanced to within 1.13× and spread over A, B and C; prompts reworded. The course-wide longest-is-correct share is under the 40 % ceiling. |
| R7 | The cases browser test | `locator('.deskbar select')` matched both the new Mode switch and the time range. | The test asks for the time range by its label. |
| R8 | C12-M08 | The authored count said 21 detections (seven per host, one an hour); the engine said 18, because the beacon jitter lets some sliding windows hold four connections. | The authored answer and prose follow the engine (six per host); the validator refused the draft before the browser did. |
| R9 | The capstone browser test | Asserting a record id in the table body failed: the id lives only in the Open button's accessible name. | The test asserts the button. |
| R10 | The third case's resolver | Case 3's DNS events pointed at the station's DC (10.9.4.2) because the generator helper hard-coded it. | A `DNS_SERVER` variable with the same default, set to 10.77.3.2 for case 3; cases 1 and 2 stay byte-identical. |
| R11 | Chapter 10's brief | With chapter 11 appended to case 2, the one-brief-per-case rule would have forced the Monday handoff to lose its model comparison. | The validator requires the last mission to be a brief and allows an earlier one; C10-M08 is untouched and C11-M09 is the case's final brief. |
| R12 | `deriveAnswer` on an invalid directory | A should-fail test that broke the co-operative's directory made the validator throw ("Invalid time value") instead of reporting. | A missing value reads as itself, so the validator reports an answer mismatch and the directory problem together. |

### Mutation checks

Applied with a script, run against the unit suite, reverted:

| Mutation | Test that failed |
|---|---|
| Rule keys no longer skip zero values | R2 (the blank hostname forms a detection without the option) |
| `condition` no longer mandatory | R3 |
| A bare field accepted in a rule | R3 |
| The window no longer slides (tumbles from the first event) | R1 (the burst that starts at the second event is missed) and R4 |
| The grader ignores the must-not-fire case | R4 |
| The validator ignores reference rows for Log it ids | C9 (the drifted-id case) |
| An unknown option accepted | R3 |
| `over N` accepted on a single-event Search query | G3, V6 and R3 |
| The directory asset LAN check removed | C13 and C14 |
| The validator's separate must-not-fire check on a rule reference removed | nothing: the line duplicated `gradeRuleCases`, which already fails the reference with `RULE_NOISY`. The line was removed and C15 now asserts the `RULE_NOISY`, `RULE_WRONG_WINDOW` and `RULE_MISSED` validator reports directly. |

### Log it record ids corrected (C1)

The new validator rule found two ids outside their mission's reference rows; both are in chapters the owner asked not to change otherwise, and neither touches a reference query, an answer value or a scoring value:

- **C03-M03** offered `evt-00140` (the `schtasks.exe` process launch at 19:35:21) as an alternative to `evt-00141` (the `SCHEDULED_TASK_CREATION` at 19:35:22). The reference returns task-creation events only; the alternative is removed and the prompt already named `evt-00141`.
- **C08-M01** cited `evt-20136` (the 19:12:31 connection from PLEDGE-DESK-01 to 198.51.100.77) for the DNS lookup of `harborlight-sponsors.example`; the lookup is `evt-20135`, one second earlier, and the reference (`not in %sponsor_domains` over DNS) returns it. The prompt and the anchor now say `evt-20135`. C07-M04, which cites `evt-20136` for the connection, was right.

### Left open after session 5

- Tenant execution of any query or rule, and a replay of the chapter 11 and 12 rules against the case data exported to a tenant.
- Entity context inside rules (chapter 10's terminated-account and `remote_access` detections are proposed in words in the C11 handoff; rule mode reports entity variables as not run here).
- Non-existence conditions, rules without `match`, three-way joins, `by first hour`.
- A must-not-fire key that the data never holds is accepted by the validator (T20 in the threat model); chapter 11 and 12 keys were chosen by hand from the data.
- A learner outside the project.

### Not verified

- Tenant execution; the sliding-window model against the real rule engine's detection timing; the Search-versus-rule differences on repeated fields and deduplication, which the flat dataset cannot show.
- Same environment as before: Node 22 with an existing Chromium build (1194) through `PIER9_CHROMIUM`, one engine, no assistive-technology session.
