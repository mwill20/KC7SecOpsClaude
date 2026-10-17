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

That regenerates the fictional dataset, validates the content against it, runs the unit tests, builds `dist/` and runs the browser tests against the build. See [docs/INSTALLATION.md](docs/INSTALLATION.md) and [docs/USAGE.md](docs/USAGE.md). Then:

```bash
npm start
```

and open http://127.0.0.1:4180. Everything runs in the page; the server only serves static files on loopback.

## What you do

Six chapters, twenty-five missions, one case: a pledge-night broadcast at a community radio station goes wrong and the board already has a suspect. Each mission is one of four kinds:

| Kind | What you get | What is scored |
|---|---|---|
| **Watch one** | A complete, explained query. Run it, read the rows, answer a question from them. | Answer 25 · Analyst call 15 |
| **Build it** | A starter with a gap. Fill it, run it, check it. | Query 60 · Answer 25 · Analyst call 15 |
| **Your turn** | An empty editor and a question. | Query 60 · Answer 25 · Analyst call 15 |
| **Read** | A side-by-side or a handoff, no query. | Analyst call 15 |

Queries are graded by **execution**: your query and the reference query both run against the same data, and you pass if the evidence matches, however you spelled it. Wrong queries get a reason (different events, different grouping, wrong order). Valid Google syntax the trainer does not implement is reported as *not run here*, separately from mistakes. Hints never cost points and the third hint is a full answer.

A time-range picker on the desk changes what the query runs against. Answers assume the whole night; the trainer tells you if you narrowed the range.

## Inputs and outputs

- Input: the text you type in the editor, the answer box and the option radios. Nothing else.
- Output: results tables, feedback text, and optional local progress (mission IDs, points, hint level) if you turn on remembering. Query text is never stored or sent anywhere.

## Layout

```
content/          case.json + chapters/C01..C06.json  (the course)
data/events.json  generated fictional UDM events (1,010)
site/engine/      parser → executor → grader (the YARA-L Search subset)
site/ui/          messages, progress store, DOM helpers
site/app.js       the single-page app
tools/            gen-data, validate-content, build, serve
tests/unit/       engine, content, progress and CSS-contrast tests (node --test)
tests/browser/    Playwright tests against dist/ (keyboard, time range, hints, drill-down, 320 px, reduced motion, CSP)
docs/             INSTALLATION.md, USAGE.md, EVALUATION.md, LIMITATIONS.md, threat-models/THREAT_MODEL.md
```

## Supported YARA-L Search subset

Filters: `=`, `!=`, `<`, `<=`, `>`, `>=`, `nocase`, regex literals `/…/`, `re.regex()`, `net.ip_in_range_cidr()`, `AND`/`OR`/`NOT`, parentheses, implicit AND, `events:` with a single `$e.` event variable, placeholders (`$x = field`), grouped fields (`ip`, `hostname`, `user`, `domain`, `file_path`, `email`), `//` and `/* */` comments.
Sections: `match` (with `by`/`over every` windows), `outcome` (`count`, `count_distinct`, `sum`, `max`, `min`), `condition`, `order`, `limit`.

Not implemented (reported as unsupported): `dedup`, arrays, joins across event variables, entity graph, `additional.fields`, most functions.

## Verification status

- `npm test`: 29 unit tests pass, including should-fail cases for the parser, grader, content, progress store and CSS contrast tokens.
- `npm run test:browser`: 8 Playwright tests pass in Chromium against `dist/`: a keyboard-only Build mission end to end, time-range change, hint reveal, record drill-down, 320 px width without horizontal overflow, reduced motion, zero CSP violations across routing, and structural accessibility checks (names, focus order, headings, live regions, skip link).
- An accessibility pass fixed sixteen findings; the list, the method and the mutation checks are in [docs/EVALUATION.md](docs/EVALUATION.md).
- **Not** compiled or executed in any Google SecOps tenant. Google's own pages disagree on `condition:` in Search; chapter 6 says so.
- One browser engine only; no session with a real screen reader.

## Limitations

See [docs/LIMITATIONS.md](docs/LIMITATIONS.md). Short version: it is a trainer with a flat fictional dataset and a documented subset, not Google's engine, and its points are formative.

## License

TODO: no license chosen. Owner decision.
