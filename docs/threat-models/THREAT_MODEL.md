# Threat model: Static on Pier Nine (Claude Edition)

Scope: a static, browser-only learning site that runs a YARA-L Search subset against a bundled fictional dataset. Framework: STRIDE on the one real trust boundary (the learner's browser tab) plus a short abuse-case list. Last reviewed 2026-10-18 alongside the Casebook branch (a second local store, a Markdown export and a clipboard write).

## Assets

1. The learner's attention and trust: they must not be taught something false or be pushed into entering real data.
2. Local progress state (points only).
2a. The learner's casebook notes: their own words about the fictional case, kept in memory or, opt-in, in a second local store.
3. The learner's device/session (a hung tab is the worst local outcome).
4. The fictional dataset's fictional-ness (it must never be mistaken for, or merged with, real logs).

## Trust boundaries

- **B1 Browser tab.** All code and data are first-party static files. Inputs: learner keystrokes in the editor, answer box, option radios and the casebook forms; `localStorage` contents under two keys; the URL hash. Outputs that leave the tab only on the learner's click: a `blob:` Markdown download and a clipboard write.
- **B2 Hosting.** Not yet decided. A static host can log request metadata; that is outside the application.

There is no server, no network egress and no third-party code, so there is no B3.

## Threats and controls

| ID | STRIDE | Threat | Control (file) | Residual |
|---|---|---|---|---|
| T1 | Tampering | Learner edits `localStorage` to award points | Points validated against a fixed set on load; invalid state ignored (`site/ui/progress.js`, `tests/unit/progress.test.mjs` P3) | Valid-looking edits succeed. Progress is personal learning state, not evidence. Accepted. |
| T2 | DoS | Pathological regex hangs the tab | Guard rejects backreferences, lookaround, nested quantifiers, large repeats; subjects truncated; dataset bounded (`site/engine/safety.js`, test G5) | Heuristic; a slow pattern that slips through freezes one tab. Accepted; no data loss. |
| T3 | DoS | Oversized or deeply nested query | Byte, token, depth, atom and section limits (`catalog.js LIMITS`, test G8) | None material. |
| T4 | Information disclosure | Real workplace values typed into the editor | Never stored or transmitted (`connect-src 'none'`; no persistence of text, test P1); boundary text on every page and in the footer | Browser/extension/device observation. Cannot be removed by the site; disclosed. |
| T5 | Spoofing | Hostile text injected via URL hash or stored state rendered as HTML | Router only matches known IDs; all rendering via text nodes (`render.js`); CSP forbids inline script | None material. |
| T6 | Tampering | Content JSON edited to teach wrong syntax or wrong answers | Content validator runs every reference, checks every authored answer against the data, checks starters do not already pass (`tools/lib.mjs`, test C1 and should-fail) | Validator trusts the engine; engine is tested against Google's documented examples. |
| T7 | Repudiation | n/a | No multi-party actions. | — |
| T8 | Elevation | n/a | No privileges exist. | — |
| T9 | Tampering / Spoofing | Hostile or malformed casebook state in `localStorage` (unknown keys, markup in strings, oversize fields, wrong types, bad IDs) is loaded, executed or echoed | Strict validation against the field specification on load; any mismatch rejects the whole blob, which is left in place; every value is bounded and rendered as a text node; enums and references are typed (`site/ui/casebook.js`, tests K4, K5, K7; browser storage test) | A valid-looking edit of one's own notes succeeds. The notes are the learner's own; nothing grades their content beyond structure. Accepted. |
| T10 | Tampering | Learner awards themselves Casebook points by editing stored progress | Part `cb` accepts only 0 or 10, under the same validator as the other parts (test P6) | Same as T1: personal learning state, not evidence. Accepted. |
| T11 | DoS | Casebook fills storage or the quota is exhausted | 96 KB bound checked before every write and the write refused with a visible reason; per-field, per-list and per-entry caps; storage exceptions caught and the store stays session-only (tests K5, K6) | None material; the learner sees the meter and can delete or export. |
| T12 | Information disclosure | Notes leave the tab through the export or the clipboard | Both happen only on the learner's click; the export is a local `blob:` download built from the entries, the clipboard write is write-only and the page never reads the clipboard; no import or upload path exists; `connect-src 'none'` unchanged (browser export test asserts loopback-only requests) | The downloaded file and the clipboard are outside the site. If the learner wrote real values into their notes against the advice on every page, the file carries them. Disclosed. |
| T13 | Information disclosure | A query the learner typed is persisted | The progress store never stores query text; the casebook stores a query only inside an Evidence entry's source, which the learner adds on purpose and can edit or delete, and only when they have opted into remembering | Same boundary text applies: fictional values only. Accepted. |

## Abuse cases

- **A1 Mistaking fiction for fact.** Mitigated by `.example` domains, documentation IP ranges (test C5), an explicit fiction notice, and chapter caveats that say "in a real tenant".
- **A2 Learning a syntax the tenant rejects.** The trainer follows Google's documented pages; where they conflict (Search `condition:`), chapter 6 says so and tells the learner to verify in their own tenant. Tenant execution has **not** been performed.
- **A3 Copying KC7.** No KC7 question, scenario, dataset or asset is used. The story, people, systems and events are original.
- **A4 Mistaking the structure check for a quality review.** The Log it feedback and the drawer say on every check that structure is checked, not the quality of thinking; `docs/LIMITATIONS.md` says the same. The brief on the last mission is self-comparison, ungraded.
- **A5 Pasting workplace notes into the casebook.** The forms are for the fictional case; the drawer footer and the home toggle repeat the boundary. The site cannot prevent it, so the store stays off by default and the export is local.

## Open items

- TODO: hosting decision and host-side headers (`frame-ancestors`, HSTS) when published.
- TODO: tenant verification of each chapter's reference query.
