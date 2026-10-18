# Static on Pier Nine — a YARA-L 2.0 Search trainer (Claude Edition)

A browser-only course that teaches Google SecOps **Search** queries in YARA-L 2.0 the way KC7 teaches KQL: through two original investigations at the same fictional station, with a query desk that actually returns rows, against fictional datasets you can poke at freely.

It was built as a comparison piece next to the owner's existing `KC7 SecOps` course. See [COMPARISON.md](COMPARISON.md) for what is the same, what is different and what was not verified.

## Who it is for

Analysts who know what a login log is and want to learn the Search dialect of YARA-L 2.0 without touching a production tenant. No account, no install, no data of yours.

## Quick start

```bash
npm ci
npx playwright install --with-deps chromium   # once; or set PIER9_CHROMIUM to an existing Chromium
npm run verify
```

That regenerates the fictional dataset, validates the content against it, runs the unit tests, builds `dist/`, checks the artifact against the runtime allowlist and runs the browser tests against the build at the root and under `/KC7SecOpsClaude/`. See [docs/INSTALLATION.md](docs/INSTALLATION.md) and [docs/USAGE.md](docs/USAGE.md). Then:

```bash
npm start
```

and open http://127.0.0.1:4180. Everything runs in the page; the server only serves static files on loopback.

To publish `dist/` on GitHub Pages, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): the workflow in `.github/workflows/pages.yml` builds, checks and uploads `dist/` only, and the owner enables Pages by hand.

## What you do

Ten chapters, eighty-two missions (seven to eleven per chapter, KC7-style density), two cases. **Static on Pier Nine** (chapters 1 to 6, 49 missions): a pledge-night broadcast at a community radio station goes wrong and the board already has a suspect. **The week after** (chapters 7 to 10, 33 missions): one week later, after the fix, the question is whether it held; the attacker returns through a second phished identity, a new lookalike and a range the gateway does not block, and probes the file server instead of the playout PC. Chapter 8 teaches data tables as the current object and reference lists as the legacy one being migrated; chapter 9 joins two events in one Search query (the gateway login and the file server as one story, and the same join finding the engineer's maintenance); chapter 10 adds entity context (who owns the host, who holds the role, which account the directory marks terminated) and asks which findings change. The home page has a case switcher; each case has its own window, time ranges, dataset, casebook and case-closed page. Each mission is one of four kinds, and every mission but the first of the course ends with a **Log it** block that asks for one entry in your Casebook:

| Kind | What you get | What is scored |
|---|---|---|
| **Watch one** | A complete, explained query. Run it, read the rows, answer a question from them. | Answer 25 · Analyst call 15 · Casebook 10 |
| **Build it** | A starter with a gap. Fill it, run it, check it. | Query 60 · Answer 25 · Analyst call 15 · Casebook 10 |
| **Your turn** | An empty editor and a question. | Query 60 · Answer 25 · Analyst call 15 · Casebook 10 |
| **Read** | A side-by-side or a handoff, no query. | Analyst call 15 · Casebook 10 (the first mission, on note-keeping, has no Log it) |

Queries are graded by **execution**: your query and the reference query both run against the same data, and you pass if the evidence matches, however you spelled it. Wrong queries get a reason (different events, different grouping, wrong order). Valid Google syntax the trainer does not implement is reported as *not run here*, separately from mistakes. Hints never cost points and the third hint is a full answer.

A time-range picker on the desk changes what the query runs against. Answers assume the whole night; the trainer tells you if you narrowed the range.

## The Casebook

Analysts keep notes; the course teaches how. The **Casebook** button in the top bar (or `Alt`+`Shift`+`C`) opens a drawer beside the desk, one casebook per case with a case switcher. Its first field is the **investigation name** (used in the header, the export title and file name, and on the case-closed page; the Scope check requires it). Then ten tabs: Scope, **FreeForm** (a blank page for raw capture with a faded template, Insert template, text-only paste, a 24 KB meter and an optional presence-only structure check; ungraded by design), Evidence, Timeline, Hypotheses, Pivots, Gaps, Determination, Remediation (Contain, Eradicate, Recover, Harden) and Handoff, the engineering ticket that is the exit point to a future Cybersecurity Engineering course. Each structured tab is a small form. On the desk, **Add to Casebook** on an open record puts its UTC time and `metadata.id` into the Evidence draft and fills the source from the current query and range; the observation is always yours to write.

Each mission's **Log it** block says which entry the mission earned and what a good one contains. **Check my Casebook** runs a deterministic structure check: required fields, `HH:MM` UTC times, record IDs that exist in the dataset, references that resolve to an Evidence entry, a supported hypothesis with support, remediation tied to evidence, and no claim words (*proves, definitely, obviously, clearly, must have*) without a record on the same entry. It also looks for the anchors the mission names (an IP, a time, a record). It checks structure, never the quality of your thinking, and never compares your text with a model answer. Passing earns the mission's 10 Casebook points and completes it.

The last mission of each case assembles your Casebook into a brief beside the authored one for self-comparison, and the case-closed page shows your Determination and Handoff ticket. Export is a local Markdown download named after the investigation; the Handoff ticket can be copied to the clipboard. The Casebook is session-only unless you tick **Remember my casebook in this browser** on the case file page (its own key, 96 KB bound shared by every case, visible meter, clearable per case).

## Inputs and outputs

- Input: the text you type in the editor, the answer box and the option radios. Nothing else.
- Output: results tables, feedback text, optional local progress (mission IDs, points, hint level) if you turn on remembering, and, separately, your Casebook notes if you turn on remembering for those. Query text is never stored by the progress store; the Casebook stores a query only when you put it in an Evidence entry's source. Nothing is sent anywhere; the Markdown export is a local download you start.

## Layout

```
content/          case.json (a cases array) + chapters/C01..C10.json + casebook.json (FreeForm template) + lists.json (legacy reference lists) + tables.json (data tables) + entities.json (the station directory)
data/             events.json (case 1, 1,010 events) and events-week-after.json (case 2, 973 events, the last two appended in session 4), both generated; case.json records each file's digest
site/engine/      parser → executor → grader (the YARA-L Search subset, engine v2 with joins and entity context)
site/ui/          messages, progress store, DOM helpers, casebook store + note check (casebook.js), casebook drawer (casebook-ui.js)
site/app.js       the single-page app
tools/            gen-data, validate-content, build, check-artifact, serve, files (runtime allowlist)
tests/unit/       engine, content, progress, casebook, CSS-contrast and artifact-allowlist tests (node --test)
tests/browser/    Playwright tests against dist/ at the root and under a subpath (keyboard, time range, hints, drill-down, 320 px, reduced motion, CSP, casebook)
docs/             INSTALLATION.md, USAGE.md, DEPLOYMENT.md, EVALUATION.md, LIMITATIONS.md, threat-models/THREAT_MODEL.md
```

## Supported YARA-L Search subset

Filters: `=`, `!=`, `<`, `<=`, `>`, `>=`, `nocase`, regex literals `/…/`, `re.regex()`, `net.ip_in_range_cidr()`, `AND`/`OR`/`NOT`, parentheses, implicit AND, `events:` with a single `$e.` event variable, placeholders (`$x = field` or `$x = function(field)`), grouped fields (`ip`, `hostname`, `user`, `domain`, `file_path`, `email`), `//` and `/* */` comments.
Functions (engine v2): `timestamp.get_hour(ts, "UTC")`, `timestamp.get_minute`, `timestamp.get_date` (zone `"UTC"` or omitted; any other zone is reported as *not run here* with the reason), `strings.to_lower`, `strings.to_upper`, `strings.concat`, in filters and placeholders; `metadata.event_timestamp` is accepted as the name of the stored timestamp.
Data tables and reference lists (engine v2, session 4): `field in %table.column`, `in cidr %table.column`, `in regex %table.column`, `not in`, `nocase`, against the tables bundled in `content/tables.json` (name, description, typed columns, rows), and the same forms with `%name` against the legacy lists in `content/lists.json`; both are shown in the **Lists and tables** panel on the desk. Search's limits are enforced: seven `in` tests per query, four of them regex, two cidr. In a tenant, tables are objects under *Detection > Data tables* and lists under *Detection > Lists*; Google migrates lists to tables automatically and retires legacy lists in July 2027; the trainer says so.
Sections: `match` (with `by`/`over every` windows), `outcome` (`count`, `count_distinct`, `sum`, `max`, `min`, `array`, `array_distinct` cut at 1,000 as in Search, `earliest`, `latest` rendered as UTC clock times), `condition`, `dedup` (between `condition` and `order`; keeps the first row per distinct key; on a summary table only grouping keys or outcomes), `order`, `limit`.
Multi-event joins (session 4, after Google's "Use conditions in search and dashboards" page): two event variables (`$e1.field`, `$e2.field`) joined by a placeholder both set, `match: $key over 1h` (events for the same key within an hour of each other, either order; `by`/`over every` buckets still work), one outcome per variable (`count($e1.metadata.id)`), `condition` with `#e1`, `$e1` (meaning `#e1 > 0`), outcome comparisons and `and`/`or`/`not`. The results bar says what was joined and how. Google's statistics page says `over` is not supported in Search while the conditions page shows it; chapter 9 teaches the conflict and tells learners to verify in a tenant.
Entity context (session 4, after the statistics page's `graph.entity.*` examples): `content/entities.json` is a small station directory (users with title, department, manager, employment status, account type, role and remote access; assets with hostname, address, owner, role and criticality), each record valid over an interval, so each case sees the directory as it stood in its window. Query it alone (`graph.metadata.entity_type = "ASSET"`, `graph.entity.user.employment_status = "TERMINATED"`) or join an event to it with the form documented for rules, `$e.principal.user.userid = $uid` and `$u.graph.entity.user.userid = $uid`, which the trainer runs against the bundled records and labels as rule-context syntax to verify in a tenant. An **Entities** panel on the desk lists the fields.

Not implemented (reported as unsupported): three or more event variables, non-existence conditions (`#e2 = 0`, `not $e2`), one condition reading two variables, entity-to-entity joins, `over N` on a single-event query, `additional.fields`, the rule-engine data-table join (`field = %table.column`), multi-stage queries, other functions, time zones other than UTC, `option` and `unselect`. The Google pages followed are listed on the About page and in `site/engine/catalog.js` (`DOCS`); the owner verified them against the live pages on 2026-10-18 and the facts the engine follows are recorded there and in `docs/EVALUATION.md`.

## Verification status

- `npm test`: 74 unit tests pass, including session-4 should-fail cases for data tables and the 7/4/2 Search limits (V5), joins (V6: unjoined variables, a placeholder set twice by one event, `#var` on an unknown variable, `over` without a key, more than two variables, a bare field in a join, a non-existence condition) and entity context (V7: entity and event fields in one filter, a window on an entity join, two entity variables; C13: the directory's validator and versions), besides the engine v2 should-fail cases (dedup key outside the grouping, a non-UTC zone, wrong function argument types, an unknown or mistyped reference list, arrays in `condition` or `order`), the investigation name and FreeForm bounds with hostile stored state and paste normalisation, the two-case model (case 1 events byte-identical by digest, case 2 fictional and inside its window, every case fed from Scope to Handoff), and a chapter-density rule (7 or more missions, at most 8 with a query desk, two Your-turn missions after chapter 1) with should-fail cases, including should-fail cases for the parser, grader, content (now including every `logIt` block), progress store (now with the `cb` part), the casebook store (hostile state, oversize, quota errors, per-case isolation) and note check (a claim word without a record, a timeline reference to a missing entry, bad times, unknown record IDs, unsupported hypotheses, remediation without evidence), CSS contrast tokens, analyst-call guessability, the example-ID feedback and the release artifact (stray files, weakened CSP, absolute references, non-fictional identifiers).
- `npm run test:browser`: 25 Playwright tests pass in Chromium against `dist/`, each run twice (the earlier 18 plus four for the name and FreeForm page, one for engine v2 on the desk, one for the two-case model and one for entities and joins on the desk) (at the origin root and under `/KC7SecOpsClaude/`, the GitHub Pages project-site shape): a keyboard-only Build mission end to end, time-range change, hint reveal, record drill-down, 320 px width without horizontal overflow, reduced motion, zero CSP violations across routing, structural accessibility checks (names, focus order, headings, live regions, skip link), starter-gap and example-ID feedback with the keyboard check shortcut, the top-bar chapter progress and the chapter page's mission map with a Watch mission completed through its Log it, a density sample (timestamp cells read as clock times on the min/max mission, a Read mission without a desk, a Your-turn timeline query graded by execution), the case-closed page in both states, and six casebook tests (drawer keyboard open/close, Insert from results through a passing note check and a named failure, Markdown download and clipboard copy, storage off and hostile stored state, the 320 px sheet, the assembled brief and the case-closed casebook section).
- An accessibility pass fixed sixteen findings; the list, the method and the mutation checks are in [docs/EVALUATION.md](docs/EVALUATION.md), along with the learner play-through and its friction log.
- **Not** compiled or executed in any Google SecOps tenant. Google's own pages disagree on `condition:` in Search (chapter 6 says so) and on `over` in Search (chapter 9 says so). The Google pages the engine follows were verified by the owner on 2026-10-18 against the live documentation.
- One browser engine only; no session with a real screen reader.

## Limitations

See [docs/LIMITATIONS.md](docs/LIMITATIONS.md). Short version: it is a trainer with a flat fictional dataset and a documented subset, not Google's engine, and its points are formative.

## License

TODO: no license chosen. Owner decision.
