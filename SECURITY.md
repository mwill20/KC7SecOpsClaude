# Security policy and boundary

This is a browser-only training site with a fictional dataset. It has no accounts, no backend, no network calls, and no connection to any SIEM. The threat model is in `docs/threat-models/THREAT_MODEL.md`.

## Controls in the code

- **No remote anything.** `connect-src 'none'` in the CSP; no fetch, no external scripts, fonts or images. Google documentation links open only on click with `rel="noopener noreferrer"`.
- **Text nodes only.** `site/ui/render.js` builds the DOM with `createElement` and `textContent`; there is no `innerHTML`, `eval` or `new Function` anywhere in `site/`.
- **Bounded parsing.** `site/engine/parser.js` caps query bytes, tokens, nesting depth, atoms, outcomes and keys (`LIMITS` in `catalog.js`) and fails closed with a code.
- **Learner regex is guarded.** The engine runs learner patterns against bounded fictional strings. `site/engine/safety.js` rejects backreferences, lookaround, nested quantifiers and large counted repeats before compiling, and truncates subjects. This is a deliberate difference from the original course, which never ran learner regex; see the threat model for the residual.
- **Progress is opt-in, bounded and typed.** `site/ui/progress.js` stores only mission IDs, point values from a fixed set and hint level, under 16 KB, validated on load. Malformed or hostile stored state is ignored and left in place, never executed or echoed. Query text and typed answers are never stored.
- **Allowlisted build.** `tools/build.mjs` copies a fixed file list into `dist/`; `tools/serve.mjs` serves only that list on loopback, read-only, with `nosniff` and `no-referrer`.
- **Fictional by construction.** `tests/unit/content.test.mjs` asserts every IP in the dataset is in RFC 5737 documentation space or the fictional 10.9.4.0/24, and every domain ends in `.example`.

## Not applicable, and why

Authentication, authorization, row-level security, secret storage and server audit logs do not apply: there are no users, roles, server resources, credentials or server-side actions. The only state is the learner's own local progress, which is personal learning state, not an audit record.

## Residual risks the code cannot remove

- A learner can type real workplace values into the editor. The site never stores or sends them, but the browser, extensions and the device can observe them. The UI says so on every page.
- Same-origin scripts, extensions or profile access can read local progress.
- Regex guarding is heuristic. A pattern that passes the guard and is still slow would freeze one tab, not leak anything.

## Reporting

TODO: no public repository yet. When one exists, enable private vulnerability reporting and link it here. Do not include real identifiers, queries or screenshots in any report.
