# Start here

**What this is.** A browser-only trainer for Google SecOps YARA-L 2.0: Search queries (chapters 1 to 10), detection rules (chapter 11) and a capstone case with less guidance (chapter 12), taught through three original fictional investigations with a query desk that returns real rows from bundled fictional data, execution-based grading, and a per-case Casebook that ends in an engineering handoff. No accounts, no network calls, no SIEM. Live at the owner's GitHub Pages site; the source of truth is this repository.

**One command.**

```bash
npm ci && npm run verify
```

`verify` regenerates the three datasets, validates every mission against the data, runs the unit tests, builds `dist/`, checks the artifact against the runtime allowlist and runs the browser tests at the root and under `/KC7SecOpsClaude/`. Browser tests need a Chromium: `npx playwright install --with-deps chromium`, or `PIER9_CHROMIUM=/path/to/chrome` for one you already have. Then `npm start` serves `dist/` on 127.0.0.1:4180.

**Where things live.**

| What | Where |
|---|---|
| Cases (story, window, ranges, chapters, data file, directory file, digest, bridge) | `content/case.json` |
| Chapters and missions | `content/chapters/C01.json` to `C12.json` |
| Casebook template, legacy lists, data tables, directories | `content/casebook.json`, `lists.json`, `tables.json`, `entities.json`, `entities-saltmarsh.json` |
| Datasets (generated, fixed seeds, digests recorded in `case.json`) | `data/*.json` from `tools/gen-data.mjs` |
| Engine: lexer and parser (Search and rule mode), executor, rule executor, grader, regex and CIDR guards, field catalog and documented facts | `site/engine/` |
| UI: the app, DOM helpers, messages, progress store, casebook store and note check, casebook drawer | `site/app.js`, `site/ui/` |
| Validator and tooling | `tools/lib.mjs` (the content validator), `validate-content.mjs`, `build.mjs`, `check-artifact.mjs`, `files.mjs` (the runtime allowlist), `serve.mjs` |
| Tests | `tests/unit/*.test.mjs` (`node --test`), `tests/browser/*.spec.mjs` (Playwright) |
| Documents | `README.md`, `COMPARISON.md`, `SECURITY.md`, `docs/USAGE.md`, `docs/ARCHITECTURE.md`, `docs/EVALUATION.md`, `docs/LIMITATIONS.md`, `docs/INSTALLATION.md`, `docs/DEPLOYMENT.md`, `docs/threat-models/THREAT_MODEL.md` |

**How a new case is added.**

1. Generate its events in `tools/gen-data.mjs` after the existing cases, with its own seed, id range (`evt-4xxxx`), window and LAN (declare a new LAN in `FICTIONAL_LANS` in `tools/lib.mjs`, `IP_OK` in `tools/check-artifact.mjs` and the content tests, or reuse one). Write the file to `data/`.
2. Add the case to `content/case.json`: id, title, tagline, role, summary, opening, people, systems, window, ranges (the first is `all`), chapters, `data`, optionally `entities` (its own directory file) and `bridge`, and the digest the validator prints when it refuses the first run.
3. Write its chapters in `content/chapters/`. Every case needs a Scope Log it on its first or second mission, every Log it kind from Scope to Handoff, and a Handoff brief (`"brief": "casebook"` with the six model parts) as its last mission. Chapter density: at least 7 missions, at most 8 with a desk, at least 2 Your-turn missions. A rule mission sets `"mode": "rule"` and carries `rule.mustFire` and `rule.mustNotFire`.
4. Run `npm run verify`. The validator proves every reference runs, every authored answer against the data, every Build starter fails until completed, every hint 3 passes, every Log it record id exists and is returned by the mission's reference, every rule reference passes its own cases, and the digest. Update the hard-coded totals in `tests/unit/content.test.mjs` and the browser specs.
5. Record the case in `README.md`, `docs/USAGE.md`, `COMPARISON.md`, `docs/EVALUATION.md` and the threat model.

**What is unverified.** No query or rule has been compiled or run in a Google SecOps tenant; the engine follows Google's pages as recorded in `site/engine/catalog.js` (verified by the owner and the owner's reviewer on 2026-10-18), and where those pages disagree (`condition` and `over` in Search) the trainer says so. One browser engine, no assistive-technology session, no learner outside the project. The full list is `docs/LIMITATIONS.md`.

**Rules for changing anything.** `AGENTS.md`: browser-only, no runtime dependencies, `connect-src 'none'`, text nodes only, execution-based grading, fictional data, every engine change with a should-fail test, no commit or push without the owner's instruction.
