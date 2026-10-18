# Static on Pier Nine — a YARA-L 2.0 Search trainer (Claude Edition)

A browser-only course that teaches Google SecOps **Search** queries in YARA-L 2.0 the way KC7 teaches KQL: through one original investigation, with a query desk that actually returns rows, against a fictional dataset you can poke at freely.

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

Six chapters, forty-nine missions (seven to eleven per chapter, KC7-style density), one case: a pledge-night broadcast at a community radio station goes wrong and the board already has a suspect. Each mission is one of four kinds, and every mission after the first ends with a **Log it** block that asks for one entry in your Casebook:

| Kind | What you get | What is scored |
|---|---|---|
| **Watch one** | A complete, explained query. Run it, read the rows, answer a question from them. | Answer 25 · Analyst call 15 · Casebook 10 |
| **Build it** | A starter with a gap. Fill it, run it, check it. | Query 60 · Answer 25 · Analyst call 15 · Casebook 10 |
| **Your turn** | An empty editor and a question. | Query 60 · Answer 25 · Analyst call 15 · Casebook 10 |
| **Read** | A side-by-side or a handoff, no query. | Analyst call 15 · Casebook 10 (the first mission, on note-keeping, has no Log it) |

Queries are graded by **execution**: your query and the reference query both run against the same data, and you pass if the evidence matches, however you spelled it. Wrong queries get a reason (different events, different grouping, wrong order). Valid Google syntax the trainer does not implement is reported as *not run here*, separately from mistakes. Hints never cost points and the third hint is a full answer.

A time-range picker on the desk changes what the query runs against. Answers assume the whole night; the trainer tells you if you narrowed the range.

## The Casebook

Analysts keep notes; the course teaches how. The **Casebook** button in the top bar (or `Alt`+`Shift`+`C`) opens a drawer beside the desk with nine tabs: Scope, Evidence, Timeline, Hypotheses, Pivots, Gaps, Determination, Remediation (Contain, Eradicate, Recover, Harden) and Handoff, the engineering ticket that is the exit point to a future Cybersecurity Engineering course. Each tab is a small structured form. On the desk, **Add to Casebook** on an open record puts its UTC time and `metadata.id` into the Evidence draft and fills the source from the current query and range; the observation is always yours to write.

Each mission's **Log it** block says which entry the mission earned and what a good one contains. **Check my Casebook** runs a deterministic structure check: required fields, `HH:MM` UTC times, record IDs that exist in the dataset, references that resolve to an Evidence entry, a supported hypothesis with support, remediation tied to evidence, and no claim words (*proves, definitely, obviously, clearly, must have*) without a record on the same entry. It also looks for the anchors the mission names (an IP, a time, a record). It checks structure, never the quality of your thinking, and never compares your text with a model answer. Passing earns the mission's 10 Casebook points and completes it.

The last mission assembles your Casebook into a brief beside the authored one for self-comparison, and the case-closed page shows your Determination and Handoff ticket. Export is a local Markdown download; the Handoff ticket can be copied to the clipboard. The Casebook is session-only unless you tick **Remember my casebook in this browser** on the case file page (its own key, 96 KB bound, visible meter, clearable per case). One casebook per case: the store is case-scoped so a later case gets its own.

## Inputs and outputs

- Input: the text you type in the editor, the answer box and the option radios. Nothing else.
- Output: results tables, feedback text, optional local progress (mission IDs, points, hint level) if you turn on remembering, and, separately, your Casebook notes if you turn on remembering for those. Query text is never stored by the progress store; the Casebook stores a query only when you put it in an Evidence entry's source. Nothing is sent anywhere; the Markdown export is a local download you start.

## Layout

```
content/          case.json + chapters/C01..C06.json  (the course)
data/events.json  generated fictional UDM events (1,010)
site/engine/      parser → executor → grader (the YARA-L Search subset)
site/ui/          messages, progress store, DOM helpers, casebook store + note check (casebook.js), casebook drawer (casebook-ui.js)
site/app.js       the single-page app
tools/            gen-data, validate-content, build, check-artifact, serve, files (runtime allowlist)
tests/unit/       engine, content, progress, casebook, CSS-contrast and artifact-allowlist tests (node --test)
tests/browser/    Playwright tests against dist/ at the root and under a subpath (keyboard, time range, hints, drill-down, 320 px, reduced motion, CSP, casebook)
docs/             INSTALLATION.md, USAGE.md, DEPLOYMENT.md, EVALUATION.md, LIMITATIONS.md, threat-models/THREAT_MODEL.md
```

## Supported YARA-L Search subset

Filters: `=`, `!=`, `<`, `<=`, `>`, `>=`, `nocase`, regex literals `/…/`, `re.regex()`, `net.ip_in_range_cidr()`, `AND`/`OR`/`NOT`, parentheses, implicit AND, `events:` with a single `$e.` event variable, placeholders (`$x = field`), grouped fields (`ip`, `hostname`, `user`, `domain`, `file_path`, `email`), `//` and `/* */` comments.
Sections: `match` (with `by`/`over every` windows), `outcome` (`count`, `count_distinct`, `sum`, `max`, `min`), `condition`, `order`, `limit`.

Not implemented (reported as unsupported): `dedup`, arrays, joins across event variables, entity graph, `additional.fields`, most functions.

## Verification status

- `npm test`: 59 unit tests pass, including a chapter-density rule (7 or more missions, at most 8 with a query desk, two Your-turn missions after chapter 1) with should-fail cases, including should-fail cases for the parser, grader, content (now including every `logIt` block), progress store (now with the `cb` part), the casebook store (hostile state, oversize, quota errors, per-case isolation) and note check (a claim word without a record, a timeline reference to a missing entry, bad times, unknown record IDs, unsupported hypotheses, remediation without evidence), CSS contrast tokens, analyst-call guessability, the example-ID feedback and the release artifact (stray files, weakened CSP, absolute references, non-fictional identifiers).
- `npm run test:browser`: 18 Playwright tests pass in Chromium against `dist/`, each run twice (at the origin root and under `/KC7SecOpsClaude/`, the GitHub Pages project-site shape): a keyboard-only Build mission end to end, time-range change, hint reveal, record drill-down, 320 px width without horizontal overflow, reduced motion, zero CSP violations across routing, structural accessibility checks (names, focus order, headings, live regions, skip link), starter-gap and example-ID feedback with the keyboard check shortcut, the top-bar chapter progress and the chapter page's mission map with a Watch mission completed through its Log it, a density sample (timestamp cells read as clock times on the min/max mission, a Read mission without a desk, a Your-turn timeline query graded by execution), the case-closed page in both states, and six casebook tests (drawer keyboard open/close, Insert from results through a passing note check and a named failure, Markdown download and clipboard copy, storage off and hostile stored state, the 320 px sheet, the assembled brief and the case-closed casebook section).
- An accessibility pass fixed sixteen findings; the list, the method and the mutation checks are in [docs/EVALUATION.md](docs/EVALUATION.md), along with the learner play-through and its friction log.
- **Not** compiled or executed in any Google SecOps tenant. Google's own pages disagree on `condition:` in Search; chapter 6 says so.
- One browser engine only; no session with a real screen reader.

## Limitations

See [docs/LIMITATIONS.md](docs/LIMITATIONS.md). Short version: it is a trainer with a flat fictional dataset and a documented subset, not Google's engine, and its points are formative.

## License

TODO: no license chosen. Owner decision.
