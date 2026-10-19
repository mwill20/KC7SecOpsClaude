# Comparison: Claude Edition vs the original KC7 SecOps course

Purpose: let the owner judge two learning experiences by using both, not by reading about them. This file says what is the same, what is different, and what was not verified. It is written by the builder of this edition, so read it as a claim sheet, not a review.

## Same on purpose

- Target: Google SecOps **Search** in YARA-L 2.0, UDM field names checked against Google's field list.
- Browser-only, no runtime dependencies, no network calls, no accounts, no SIEM connection.
- Deterministic grading (no AI, no string matching). Unsupported Google syntax is reported separately from invalid syntax and from wrong answers.
- Three progressive hints, no penalty, last hint is a full answer.
- Opt-in local progress that never stores query text.
- Plain-language boundary text about workplace data on every page.

## Different on purpose

| Area | Original (Codex) | Claude Edition | Why |
|---|---|---|---|
| Data | None. Learner runs queries in their own SecOps, off-site | 1,010 fictional UDM events bundled; queries return rows here | The run-query-see-rows loop is what makes KC7 work; it also lets you train away from work |
| Grading | AST equivalence against a reference | Execution: student and reference run on the same data; pass if evidence matches | Any correct spelling passes; wrong queries get a reason (different events / grouping / order) |
| Story | Midnight at Meridian (planetarium) | Static on Pier Nine (community radio) — original, same KC7 pattern | Owner asked for a new story with its own voice |
| Missions | 16, mostly shown/guided, one short independent | 101 across four kinds: Watch one, Build it, Your turn, Read; 49 in the first case, 42 in a second case one week later that asks whether the fix held, whether the events are one story, who owns the hosts and which questions become rules, and 10 in a third case at a different organisation with the question and the Log it only | More independence, earlier; no full marks for pressing Check on a prefilled query; a second case for a quieter night; a third for a capstone the learner works alone |
| Layout | Single long page | Split pane: lesson left, sticky query desk right; stacks on phones | Less scrolling between story, editor and results |
| Feedback | Diagnostic codes with a generic sentence | Every code mapped to "what happened / what to try"; comparison reasons for wrong evidence | F4 in the critique |
| Time range | Prose instruction only | A picker on the desk; results change; answers warn if you narrowed | F8 in the critique |
| Answer questions | None (method MCQs only) | A KC7-style "read it from your results" question per mission plus one analyst-call MCQ | Reading results is the skill |
| Syntax breadth | Placeholders only; `$e.` forms rejected | `$e.` event variable, `events:`, grouped fields, `/* */` comments, `>= / <= / < / >`, `max/min`, `by`/`over every` windows; engine v2 adds `dedup`, `array`/`array_distinct`, `earliest`/`latest`, `timestamp.get_hour`/`get_minute`/`get_date` (UTC), `strings.to_lower`/`to_upper`/`concat`, and reference lists (`in %`, `in cidr %`, `in regex %`) against bundled lists | Closer to what learners meet in Google's docs; everything outside the subset is still reported as *not run here* |
| Learner regex | Never executed | Executed in the browser behind a guard (no backrefs, lookaround, nested quantifiers) | Needed for real results; see THREAT_MODEL T2 |
| Placeholders | `__USER__`-style tokens, real-looking values rejected | Fictional values typed directly (the data is fictional) | No placeholder rule is needed when nothing is real |
| Note-keeping | None | A persistent per-case **Casebook** (an investigation name, scope, a FreeForm page for raw capture, evidence with record IDs, timeline, hypotheses, pivots, gaps, determination, remediation in four lists, engineering handoff), a first mission on how analysts keep notes and when to use the page versus the tabs, a "Log it" block on every other mission, a deterministic structure check worth 10 points, Insert from results, Markdown export and a case-closed section per case | KC7 teaches the query; an analyst is judged on the notes. The handoff tab is the exit to a planned engineering course |
| Reference lists and data tables | None | Four bundled data tables and five legacy lists in a Lists and tables panel, used by chapter 8 to tune out the known-good, to show an allowlist written too wide (its source column says which rows came from a log), and to teach the list-to-table migration and its July 2027 date; Search's limits of seven, four and two `in` tests are enforced | The table is a control; writing one badly is a lesson worth a chapter |
| Multi-event joins | None | Two event variables joined by a shared placeholder with `match: $key over 1h`, per-variable outcomes and `#e1` conditions, used by chapter 9 to make the gateway login and the file server one story, to find the engineer's maintenance with the same shape, and to widen the window until the coincidences appear; the documentation conflict on `over` in Search is taught, not hidden | Correlation is a claim with a key and a window; a learner should write it and see its cost |
| Rule mode | None | A Mode switch on the desk runs the editor as a YARA-L 2.0 detection rule in a documented subset (envelope, meta, events with $e, match over a sliding window, outcome, mandatory condition, allow_zero_values, the data-table join); detections instead of rows; every rule mission graded against a must-fire case and a must-not-fire case with the false-positive count shown; chapter 11 rewrites the course's best questions as rules, measures the Search-versus-rule count on the same data and ends in a detection handoff with replay and approval | A query answers once; a rule keeps answering, and a detection engineer tests it against cases, not against a reference |
| Third case | None | A different organisation (a ferry co-operative), a different shape (a trojanised vendor update: plugin, task, beacon, archive, upload, and a suspect to clear), its own dataset, LAN, directory and casebook; eight desk missions with no explained parts, a Determination and a Handoff beside the model, and an engineering bridge on the closed page | The exam without a mark: the habits are only learned when nobody is explaining |
| Entity context | None | A bundled station directory (users, assets, validity intervals) queried with `graph.entity.*` fields and joined to events with the rule-context form, used by chapter 10 for ownership, criticality, a terminated account that still appears in events, title against privilege, and a Remediation that names an owner | Context changes what a finding stands on more than what it says |

## Scoring

Watch 50 (answer 25 + call 15 + casebook 10) · Build/Your turn 110 (query or rule 60 + answer 25 + call 15 + casebook 10) · Read 25 (call 15 + casebook 10; the opening read mission on note-keeping is 15 alone). Course total 8,600 over 101 missions (4,355 in the first case, 3,315 in the second, 930 in the third). Parts are independent checks, so each is recorded separately; a mission is complete when every part is correct, and the Casebook part is a structure check (fields, UTC times, record IDs that exist, references that resolve, no claim words without a record) that never grades the quality of the thinking.

## What was verified

- `npm test`: 82 unit tests, including should-fail cases for rule mode (a missing condition, a field without its event variable, over without a match key, a rule that fires on the must-not-fire case, an unknown option, the envelope mistakes, the data-table join), for the third case (its LAN, digest, directory, chapter shape and bridge), for a Log it id outside the reference rows, for every engine v2 construct, for data tables and the Search list limits, for joins and for entity context, the name and FreeForm bounds, and the digest proofs, besides the earlier cases (parser rejects bad shapes with the right code; grader fails plausible wrong queries; content validator catches a drifted answer and a bad `logIt` block; progress and casebook stores ignore hostile state; the note check fails a claim word without a record and a timeline reference to a missing entry; the contrast check rejects a low-contrast token).
- `npm run validate:content`: every reference runs; every authored answer equals what the data returns; every Build starter fails until completed; every Watch starter equals its reference.
- `npm run test:browser`: 27 Playwright tests in Chromium against the built `dist/`, no retries, no sleeps, each at the root and under `/KC7SecOpsClaude/`: rule mode on the desk (detections, the two test cases, the false-positive count, the Mode switch against the Search count), the third case (its directory, a capstone mission without explained parts, the bridge once complete), a Build mission completed with the keyboard only (invalid → correct → answer → call → clue → next), a Watch mission with a time-range change and the narrower-range warning, hint reveal with focus management, record drill-down with focus return, 320 px width with no horizontal overflow, reduced motion, zero `securitypolicyviolation` events and zero non-loopback requests across every route and interaction, structural accessibility assertions, and the casebook: keyboard open/close with focus return, Insert from results through a passing note check and a named failure, Markdown download and clipboard copy, storage off leaving `localStorage` empty and hostile stored state left in place, the 320 px sheet, and the assembled brief with the case-closed casebook section.
- An accessibility pass (names, focus order, headings, live regions, token contrast) with sixteen fixes, each re-checked by a test. Method, findings and mutation checks: [docs/EVALUATION.md](docs/EVALUATION.md).
- The earlier manual click-through in one desktop browser still stands; it is now superseded by the tests above for everything it covered.

## What was not verified

- Nothing has been compiled or run in a Google SecOps tenant, neither a Search query nor a rule. Google's pages disagree on `condition:` in Search (chapter 6 says so) and on `over` in Search (chapter 9 says so); Google says Search and rule counts differ by design (chapter 11 shows the window difference). The Google pages the engine follows were verified by the owner (engine v2) and the owner's reviewer (rule mode) on 2026-10-18 against the live documentation; the URLs and the facts recorded are in `site/engine/catalog.js` and on the About page.
- No session with a real screen reader, and no browser-zoom (200%) run; the live-region and focus checks are structural.
- Only one browser engine (Chromium).
- Learning effectiveness: nobody but the builder has used it.
- The quality of casebook entries. The check is structural; two learners can both pass with notes of very different value.

## How to compare fairly

Do chapter 1 of each edition back to back with a timer. Note where you looked for something and could not find it, where you guessed, and where you learned a rule you did not know. Then decide which habits each edition built.
