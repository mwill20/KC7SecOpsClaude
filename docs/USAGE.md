# Usage

## The loop

1. Open the case file (home). Read the opening and the people table. Pick a chapter, or press **Open the case** to go to the first unfinished mission.
2. On a mission, the left pane is the lesson: the story beat, the question, the concept, the explained query parts, hints and the case update once you finish. The right pane is the query desk.
3. Type in the editor and press **Run query** (or `Ctrl`+`Enter`). The results table shows what the data returns for the selected time range.
4. Press **Check query** on Build and Your-turn missions. Your query and the reference both run; you pass if they return the same evidence, however you spelled it.
5. Read the answer from your own results, type it in **From your results**, press **Check answer** (or `Enter`).
6. Pick an **Analyst call** option and press **Check call**. You get an explanation either way.
7. When all parts are correct, the **Case update** card appears in the lesson pane and the next-mission link turns primary.

Watch-one missions skip step 4 (the query is given). Read missions skip steps 3 to 5 (no query).

## The desk, in detail

- **Time range.** Changes what the query runs against and clears stale results. Answers always assume the whole night; if you check an answer with a narrower range selected, the feedback says so.
- **Feedback line.** Three kinds, never blurred: *Will not run* (your syntax is broken; the fix line says what to change), *Not run here* (valid Google syntax this trainer does not implement), and a comparison reason when the query runs but returns different evidence (different events, different grouping, wrong order, with counts).
- **Results.** Up to 200 rows are shown. The first column of an event table has an **Open** button per row; it opens the full record below the table, moves focus there, and **Close** returns focus to the row. Click anywhere on a row to do the same with a mouse.
- **Field list.** A collapsed list of every UDM field in the dataset with its type.
- **Reset.** Restores the starter query and clears results.
- **Hints.** Up to three, free. The third is a full answer on Build and Your-turn missions. Revealing a hint moves focus to it.

## Keyboard

Everything works without a mouse. `Tab` moves through the header, the lesson pane (breadcrumbs, hints, previous/next links) and then the desk (time range, editor, Run, Check, Reset, field list, result rows, answer box, analyst-call radios, Check call). `Shift`+`Tab` goes back. In the editor, `Ctrl`+`Enter` runs; `Tab` leaves the editor rather than inserting a tab. Arrow keys move between analyst-call options. The first `Tab` on any page reaches **Skip to content**, which moves focus into the page without changing the route.

## Progress

Progress is in memory for this tab only unless you tick **Remember my points in this browser** on the home page. Remembering stores mission IDs, points from a fixed set and the highest hint level, under 16 KB, in `localStorage`. Query text and typed answers are never stored. **Clear all progress** wipes both memory and storage. On a shared device, leave remembering off.

## What not to type

The dataset is fiction. Do not paste real hostnames, user IDs, addresses or queries from your workplace into the editor. The site never sends or stores them, but your browser, extensions and device can see them. Practise the query shape here; use real values only inside tools your employer authorizes.

## Reading the scores

Query 60, answer 25, analyst call 15 (Watch missions have no query points; Read missions only the call). Course total 1,970. Points are formative: hints are free, the last hint is the answer, and local progress is editable. Nothing here is a credential.
