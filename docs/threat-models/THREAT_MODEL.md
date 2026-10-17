# Threat model: Static on Pier Nine (Claude Edition)

Scope: a static, browser-only learning site that runs a YARA-L Search subset against a bundled fictional dataset. Framework: STRIDE on the one real trust boundary (the learner's browser tab) plus a short abuse-case list. Last reviewed 2026-10-17 alongside the first build.

## Assets

1. The learner's attention and trust: they must not be taught something false or be pushed into entering real data.
2. Local progress state (points only).
3. The learner's device/session (a hung tab is the worst local outcome).
4. The fictional dataset's fictional-ness (it must never be mistaken for, or merged with, real logs).

## Trust boundaries

- **B1 Browser tab.** All code and data are first-party static files. Inputs: learner keystrokes in the editor, answer box and option radios; `localStorage` contents; the URL hash.
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

## Abuse cases

- **A1 Mistaking fiction for fact.** Mitigated by `.example` domains, documentation IP ranges (test C5), an explicit fiction notice, and chapter caveats that say "in a real tenant".
- **A2 Learning a syntax the tenant rejects.** The trainer follows Google's documented pages; where they conflict (Search `condition:`), chapter 6 says so and tells the learner to verify in their own tenant. Tenant execution has **not** been performed.
- **A3 Copying KC7.** No KC7 question, scenario, dataset or asset is used. The story, people, systems and events are original.

## Open items

- TODO: hosting decision and host-side headers (`frame-ancestors`, HSTS) when published.
- TODO: tenant verification of each chapter's reference query.
