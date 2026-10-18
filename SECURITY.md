# Security policy and boundary

This is a browser-only training site with a fictional dataset. It has no accounts, no backend, no network calls, and no connection to any SIEM. The threat model is in `docs/threat-models/THREAT_MODEL.md`.

## Controls in the code

- **No remote anything.** `connect-src 'none'` in the CSP; no fetch, no external scripts, fonts or images. Google documentation links open only on click with `rel="noopener noreferrer"`.
- **Text nodes only.** `site/ui/render.js` builds the DOM with `createElement` and `textContent`; there is no `innerHTML`, `eval` or `new Function` anywhere in `site/`.
- **Bounded parsing.** `site/engine/parser.js` caps query bytes, tokens, nesting depth, atoms, outcomes and keys (`LIMITS` in `catalog.js`) and fails closed with a code.
- **Learner regex is guarded.** The engine runs learner patterns against bounded fictional strings. `site/engine/safety.js` rejects backreferences, lookaround, nested quantifiers and large counted repeats before compiling, and truncates subjects. This is a deliberate difference from the original course, which never ran learner regex; see the threat model for the residual.
- **Progress is opt-in, bounded and typed.** `site/ui/progress.js` stores only mission IDs, point values from a fixed set (including the 10-point Casebook part) and hint level, under 16 KB, validated on load. Malformed or hostile stored state is ignored and left in place, never executed or echoed. Query text and typed answers are never stored.
- **The Casebook is a second opt-in, bounded, typed store.** `site/ui/casebook.js` keeps the learner's own notes under its own key (`pier9.casebook.v1`), off by default, bounded at 96 KB with the write refused rather than truncated when it would pass the bound, every field bounded (4,000 characters, 200 entries per list, 50 records or references per entry; the investigation name at 120 characters; the FreeForm page at 24 KB of UTF-8, refused rather than truncated, with paste reduced to plain text and control characters stripped), enums restricted to fixed sets, references stored as integers, and the whole state validated against the field specification on load: an unknown key, a bad case or entry ID, an oversize field or a wrong type rejects the blob, which is left in place and never executed or echoed. Entries render through text nodes like everything else, so a stored `<img onerror>` is a string in a paragraph. Storage that throws leaves the casebook session-only. The learner can clear one case or all. `tests/unit/casebook.test.mjs` proves each of these, including hostile name and FreeForm values. The export file name is derived from the investigation name reduced to lower-case letters, digits and hyphens (40 characters), so a name cannot steer the download path.
- **Export is local and user-initiated.** The Markdown export builds a string from the entries and offers it through a `blob:` download the learner clicks; the Handoff ticket is written to the clipboard only on click, write-only, and the page never reads the clipboard. No import, no upload, no file API beyond the download.
- **Allowlisted build.** `tools/build.mjs` copies the fixed file list in `tools/files.mjs` into `dist/`; `tools/serve.mjs` serves only that list on loopback, read-only, with `nosniff` and `no-referrer`.
- **Checked release artifact.** `tools/check-artifact.mjs` runs after every build and refuses a `dist/` that holds anything beyond the allowlist, whose `index.html` lost `connect-src 'none'`, that references anything by absolute or remote URL, or that names a non-`.example` domain or an IP outside the documentation ranges. `tests/unit/artifact.test.mjs` proves it rejects each of those.
- **Fictional by construction.** `tests/unit/content.test.mjs` asserts every IP in both datasets is in RFC 5737 documentation space or the fictional 10.9.4.0/24, and every domain ends in `.example`; the validator proves each case's events by digest.
- **The station directory is content, not input.** `content/entities.json` is validated at build time (fictional station addresses, upper-case hostnames, owners that exist, enumerated statuses, non-overlapping validity intervals) and bundled read-only as flat `graph.*` records; the Entities panel and entity results render through text nodes; a query can only read an entity record, never create one, and an entity joins an event only through a placeholder the query sets on both sides.
- **Reference lists and data tables are content, not input.** `content/lists.json` and `content/tables.json` are validated at build time (names, the three documented types, CIDR items that parse, regex items that pass the same guard as learner regex, bounded item counts and lengths) and bundled read-only; the Lists and tables panel renders names, descriptions, columns, rows and items as text nodes; a query can only name a list or a table column, never define or edit one. A regex list item is compiled through `safety.js` with the subject truncation every learner pattern gets.
- **One store, several cases.** The casebook store keeps every case under its own id inside the same key and the same 96 KB bound; each case's entries are validated against the same field specification and checked against that case's own record IDs, so a note from one case cannot cite the other case's records and pass.

## Not applicable, and why

Authentication, authorization, row-level security, secret storage and server audit logs do not apply: there are no users, roles, server resources, credentials or server-side actions. The only state is the learner's own local progress, which is personal learning state, not an audit record.

## Residual risks the code cannot remove

- A learner can type real workplace values into the editor. The site never stores or sends them, but the browser, extensions and the device can observe them. The UI says so on every page.
- Same-origin scripts, extensions or profile access can read local progress and, when remembering is on, the learner's casebook notes. The notes are the learner's own words about a fictional case; the UI says not to put real values in them, and the Casebook stays session-only unless the learner opts in.
- The exported Markdown file lands in the browser's download folder and the copied ticket sits on the system clipboard, both outside the site's control. Both are user-initiated and contain only the learner's notes.
- Regex guarding is heuristic. A pattern that passes the guard and is still slow would freeze one tab, not leak anything.

## Release boundary

Publishing is a separate decision from building. The only release path is `.github/workflows/pages.yml`, which uploads `dist/` alone, after the content validator, the unit tests and the artifact check have passed, with a read-only token everywhere except the deploy job. The workflow does not enable Pages, change visibility or pick a plan; the owner does those by hand. What the host logs, which headers it sets and what the repository path shares with other sites on the same origin are described in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Publishing does not make the course employer-approved.

## Reporting

TODO: no public repository yet. When one exists, enable private vulnerability reporting and link it here. Do not include real identifiers, queries or screenshots in any report.
