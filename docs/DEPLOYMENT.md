# Deployment to GitHub Pages

The course is static files. Publishing it means serving `dist/` as-is from a static host. This document describes the GitHub Actions workflow that does that, what the owner has to do by hand, and what publishing does and does not mean.

Status: the workflow exists on `main`; whether it has been run, and at what URL, is the owner's call. Nothing in this repository enables Pages, changes visibility or picks a plan.

## What the workflow does

`.github/workflows/pages.yml` runs on every push to `main` and on manual dispatch (Actions > *Deploy course to GitHub Pages* > *Run workflow*). It only ever publishes `main`; a dispatch from any other branch is skipped. Three jobs:

| Job | Permissions | What it does |
|---|---|---|
| `build` | `contents: read` | `npm ci`, regenerate the dataset, run the content validator, run the unit tests, `npm run build` (which ends with `tools/check-artifact.mjs`), then upload **`dist/` only** as the Pages artifact. |
| `browser` | `contents: read` | Installs Chromium and runs the Playwright suite against the same commit, once at the origin root and once under `/KC7SecOpsClaude/`. Runs in parallel with `build` and **does not gate** `deploy`. |
| `deploy` | `pages: write`, `id-token: write` | Takes the uploaded artifact and deploys it through the `github-pages` environment. Needs `build` only. |

Why the browser tests do not gate the deploy: the Chromium download and its system packages add a minute or more to every run, and the artifact is already proven before upload by the content validator (every authored answer against the data, every Build starter failing until completed), the unit tests (82, including the artifact should-fail cases) and the artifact check. A red `browser` job is still visible on the run and is a bug to fix on `main`. To make it gate, change the deploy job to `needs: [build, browser]`.

Other properties of the workflow:

- Every action is pinned to a full commit SHA with the tag it was checked against in a comment. Update the SHA and the comment together.
- `persist-credentials: false` on checkout, `npm ci --ignore-scripts`, and the default token is read-only; only the deploy job gets the two Pages scopes.
- One concurrency group (`pages-deploy`) with `cancel-in-progress: false`: deployments queue rather than cancel each other.
- Node comes from `.node-version` (24).

## What the artifact check proves

`tools/check-artifact.mjs` runs at the end of `npm run build` and in `npm run verify`, and the `build` job will not reach the upload step if it fails. It walks `dist/` and refuses the artifact unless:

- the file set is **exactly** the runtime allowlist in `tools/files.mjs` (twelve files): no tests, docs, `node_modules`, `.git`, the raw `data/events.json`, dotfiles or symlinks;
- every copied file is byte-identical to its source under `site/`;
- `index.html` still carries `default-src 'none'` and `connect-src 'none'`, and no `src` or `href` in it is absolute or remote;
- every `import` in the JavaScript is relative and resolves to a file in the allowlist, and no file uses `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`, `eval`, `new Function` or `innerHTML`;
- every IPv4 address is in RFC 5737 documentation space or the fictional `10.9.4.0/24`, and every domain ends in `.example`, with one named exception: `docs.cloud.google.com`, the documentation the UI links to on click.

`tests/unit/artifact.test.mjs` plants a stray file, a dotfile, a nested test file, a modified copy, a missing file, a symlink, a weakened CSP, absolute and remote references, a real-looking IP, a non-`.example` domain, a remote import and a `fetch` call into temporary copies and asserts each one is rejected.

## Why the same dist/ works at the root and at `/KC7SecOpsClaude/`

A project site on GitHub Pages lives under `https://<owner>.github.io/<repository>/`. The site uses only relative paths (`styles.css`, `app.js`, `./bundle.js`, `./engine/...`) and hash routing (`#C01-M02`), so no base path is configured anywhere and the same bytes work at a subpath and at an origin root. The artifact check enforces this (no absolute `src`/`href`, no non-relative imports), and the Playwright configuration runs every browser test twice: once against `tools/serve.mjs` at the root and once with `PIER9_BASE=/KC7SecOpsClaude/`, which mounts `dist/` under that prefix the way Pages will. To preview the subpath shape locally:

```bash
npm run build
PIER9_BASE=/KC7SecOpsClaude/ npm start    # http://127.0.0.1:4180/KC7SecOpsClaude/
```

## What the owner must do by hand

1. Merge the pull request that adds the workflow to `main`.
2. **Settings > Pages > Build and deployment > Source: GitHub Actions.** The workflow cannot do this; until it is set, the `deploy` job fails with a Pages-not-enabled error while `build` and `browser` still run.
3. Push to `main` or dispatch the workflow. The run's `deploy` job shows the URL. For this repository it will be:

   `https://mwill20.github.io/KC7SecOpsClaude/`

4. Open it and run through one mission. Check that the page makes no requests other than to its own origin (browser devtools, Network tab) and that the CSP meta tag is present (`view-source`).

Optional, after the first deploy: `Settings > Pages > Enforce HTTPS` should already be on; confirm it.

## Plan and visibility note

GitHub Pages on a **private** repository requires a paid GitHub plan (Pro, Team or Enterprise). On a free plan, Pages only publishes from a **public** repository. So the owner must either make the repository public or move to a paid plan before the `deploy` job can succeed. This document recommends neither; it states the constraint. Making the repository public also publishes the source, the fictional dataset, the docs and the git history, not only `dist/`. The licence question in `README.md` is still open and is independent of this.

## What publishing does and does not mean

- **A public host logs request metadata.** GitHub Pages, like any static host, sees and may log the requester's IP address, user agent, referrer and the paths fetched. The application itself still makes no network calls, stores nothing remotely and sends no telemetry; that boundary is in `SECURITY.md` and is checked by the CSP, the artifact check and the browser tests. What the host logs is outside the application and outside this repository's control.
- **Publishing does not make the course employer-approved.** Hosting it on a public URL is a distribution decision, not a review. Anyone using it at work should treat it as they would any third-party training material and should never type real workplace values into it; the site says so on every page.
- **The host controls the headers.** The CSP is a `<meta>` tag, so `frame-ancestors`, HSTS and `Permissions-Policy` are whatever GitHub Pages sets. Do not claim framing protection the host does not provide (`docs/threat-models/THREAT_MODEL.md`, B2).
- **Other scripts on the `mwill20.github.io` origin** (other project sites of the same owner) share the origin from the browser's point of view, including `localStorage`. The progress store validates and bounds what it reads, but the repository path is not an isolation boundary.
- **Nothing tenant-verified changes.** The reference queries have still not been compiled in a Google SecOps tenant; chapter 6 and `docs/LIMITATIONS.md` say so, and the deploy does not alter that.

## Rolling back

Pages serves the latest successful deployment. To roll back, revert the commit on `main` and let the workflow run again, or dispatch the workflow from a `main` that has been reset by the owner. There is no separate rollback button in the workflow.
