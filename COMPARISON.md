# Comparison: Claude Edition vs the original KC7 SecOps course

Purpose: let the owner judge two learning experiences by using both, not by reading about them. This file says what is the same, what is different, and what was not verified. It is written by the builder of this edition, so read it as a claim sheet, not a review.

## Same on purpose

- Target: Google SecOps **Search** in YARA-L 2.0, UDM field names checked against Google's field list.
- Browser-only, no runtime dependencies, no network calls, no accounts, no SIEM connection.
- Deterministic grading (no AI, no string matching). Unsupported Google syntax is reported separately from invalid syntax and from wrong answers.
- Three progressive hints, no penalty, last hint is a full answer.
- Opt-in local progress that never stores query text.
- Plain-language boundary text about workplace data on every page.

## Different on purpose

| Area | Original (Codex) | Claude Edition | Why |
|---|---|---|---|
| Data | None. Learner runs queries in their own SecOps, off-site | 1,010 fictional UDM events bundled; queries return rows here | The run-query-see-rows loop is what makes KC7 work; it also lets you train away from work |
| Grading | AST equivalence against a reference | Execution: student and reference run on the same data; pass if evidence matches | Any correct spelling passes; wrong queries get a reason (different events / grouping / order) |
| Story | Midnight at Meridian (planetarium) | Static on Pier Nine (community radio) — original, same KC7 pattern | Owner asked for a new story with its own voice |
| Missions | 16, mostly shown/guided, one short independent | 25 across four kinds: Watch one, Build it, Your turn, Read; capstone chains four conditions | More independence, earlier; no full marks for pressing Check on a prefilled query |
| Layout | Single long page | Split pane: lesson left, sticky query desk right; stacks on phones | Less scrolling between story, editor and results |
| Feedback | Diagnostic codes with a generic sentence | Every code mapped to "what happened / what to try"; comparison reasons for wrong evidence | F4 in the critique |
| Time range | Prose instruction only | A picker on the desk; results change; answers warn if you narrowed | F8 in the critique |
| Answer questions | None (method MCQs only) | A KC7-style "read it from your results" question per mission plus one analyst-call MCQ | Reading results is the skill |
| Syntax breadth | Placeholders only; `$e.` forms rejected | `$e.` event variable, `events:`, grouped fields, `/* */` comments, `>= / <= / < / >`, `max/min`, `by`/`over every` windows | Closer to what learners meet in Google's docs |
| Learner regex | Never executed | Executed in the browser behind a guard (no backrefs, lookaround, nested quantifiers) | Needed for real results; see THREAT_MODEL T2 |
| Placeholders | `__USER__`-style tokens, real-looking values rejected | Fictional values typed directly (the data is fictional) | No placeholder rule is needed when nothing is real |

## Scoring

Watch 40 (answer 25 + call 15) · Build/Your turn 100 (query 60 + answer 25 + call 15) · Read 15. Course total 1,970. Parts are independent checks, so each is recorded separately; a mission is complete when every part is correct.

## What was verified

- `npm test`: 25 unit tests, including should-fail cases (parser rejects bad shapes with the right code; grader fails plausible wrong queries; content validator catches a drifted answer; progress store ignores hostile state).
- `npm run validate:content`: every reference runs; every authored answer equals what the data returns; every Build starter fails until completed; every Watch starter equals its reference.
- Manual click-through in the Claude desktop browser pane at desktop width: home, chapter, a Build mission end to end (invalid → correct → answer → call → clue), a Watch mission with time-range change, record drill-down and hints, a chapter 6 bucket query, the About page, and a phone-width render. Zero CSP violations during routing after the inline-style fix.

## What was not verified

- Nothing has been compiled or run in a Google SecOps tenant. Google's pages disagree on `condition:` in Search; chapter 6 says so.
- No Playwright, screen-reader, keyboard-only or 200% zoom testing.
- Only one browser engine.
- Learning effectiveness: nobody but the builder has used it.

## How to compare fairly

Do chapter 1 of each edition back to back with a timer. Note where you looked for something and could not find it, where you guessed, and where you learned a rule you did not know. Then decide which habits each edition built.
