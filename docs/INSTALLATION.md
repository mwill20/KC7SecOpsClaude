# Installation

The trainer is static files. Node is needed only to regenerate the dataset, run the checks and serve `dist/` on loopback. Nothing is installed at runtime and the page makes no network calls.

## Requirements

- Node.js 24 or newer (`.node-version` says 24; the checks also run on 22, which npm warns about but does not block).
- npm (ships with Node).
- For the browser tests only: a Chromium that Playwright can drive. See below.

## Steps

```bash
git clone <this repository>
cd KC7SecOpsClaude
npm ci                                   # installs @playwright/test, the only dev dependency
npx playwright install --with-deps chromium   # one-time browser download; skip if you point PIER9_CHROMIUM at an existing Chromium
npm run verify                           # data → content validation → unit tests → build → browser tests
npm start                                # serves dist/ at http://127.0.0.1:4180
```

`npm run verify` must finish with `54 passed` from Playwright (27 tests, each at the root and under `/KC7SecOpsClaude/`) after `# fail 0` from `node --test` (82 tests) and `artifact check passed` from the build. If it does not, do not use the build.

## Scripts

| Script | What it does |
|---|---|
| `npm run data` | Regenerates the three datasets (`data/events.json`, 1,010 events; `data/events-week-after.json`, 973; `data/events-saltmarsh.json`, 675), fixed seeds. |
| `npm run validate:content` | Runs every reference query, proves every authored answer against the data, proves every Build starter fails until completed. |
| `npm test` | Unit tests: parser, executor, rule mode, grader, content, progress store, casebook, CSS contrast tokens, artifact check. |
| `npm run build` | Copies the allowlisted runtime files into `dist/`, writes `dist/bundle.js` (content + data), then runs `tools/check-artifact.mjs`. |
| `npm run check:artifact` | Re-runs the artifact check on the current `dist/` without rebuilding. |
| `npm run test:browser` | Playwright tests against `dist/` served by `tools/serve.mjs`: once at the root on port 4187, once under `/KC7SecOpsClaude/` on port 4188. Build first. |
| `npm run verify` | All of the above, in order. |
| `npm start` | Local preview on 127.0.0.1:4180 (`PIER9_PORT` overrides; `PIER9_BASE=/KC7SecOpsClaude/` mounts it under that prefix). Serves what is in `dist/`; build first. |

## Using a Chromium you already have

Playwright 1.64.1 wants its own Chromium build. If downloads are not possible, or you want to drive a Chromium that is already on the machine, set `PIER9_CHROMIUM` to the binary path:

```bash
PIER9_CHROMIUM=/opt/pw-browsers/chromium npm run verify
```

`playwright.config.mjs` passes that path as `executablePath` and otherwise leaves Playwright's defaults alone. Do not set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` and expect `npx playwright install` to help; pick one of the two routes.

## Hosting

Any static host that serves `dist/` as-is works. A GitHub Pages workflow and what the owner has to do by hand are in [DEPLOYMENT.md](DEPLOYMENT.md); whether and where to publish is still the owner's decision (see `docs/threat-models/THREAT_MODEL.md`, open items). The CSP is a `<meta>` tag, so host headers add to it rather than replace it; `frame-ancestors` and HSTS can only be set by the host.

## Uninstall

Delete the clone. If a learner turned on "Remember my points", the only trace is one `localStorage` key (`pier9.progress.v1`) in their browser profile; the home page's "Clear all progress" button removes it.
