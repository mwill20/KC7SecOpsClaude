# Usage

## The loop

1. Open the case file (home). Read the opening and the people table. Pick a chapter, or press **Open the case** to go to the first unfinished mission.
2. On a mission, the left pane is the lesson: the story beat, the question, the concept, the explained query parts, hints and the case update once you finish. The right pane is the query desk.
3. Type in the editor and press **Run query** (or `Ctrl`+`Enter`). The results table shows what the data returns for the selected time range.
4. Press **Check query** on Build and Your-turn missions. Your query and the reference both run; you pass if they return the same evidence, however you spelled it.
5. Read the answer from your own results, type it in **From your results**, press **Check answer** (or `Enter`).
6. Pick an **Analyst call** option and press **Check call**. You get an explanation either way.
7. When the query, answer and call are correct, the **Case update** card appears in the lesson pane. A **Log it** block has already appeared (after the query is correct on Build and Your-turn missions, after the answer on Watch missions, after the call on Read missions): it names the Casebook entry this mission earned and what a good one contains. Write the entry in the Casebook, press **Check my Casebook**, and the mission is complete; the next-mission link turns primary.
8. Each chapter page ends with a **recap card**: what the chapter will teach, which turns into "you can now" once every mission in it is complete. When all 26 missions are complete, the home page and the last mission link to **Case closed**, the handoff laid out as facts, hypotheses and gaps, with your own Determination and Handoff ticket beside it.

Watch-one missions skip step 4 (the query is given). Read missions skip steps 3 to 5 (no query). The first mission teaches note-keeping and has no Log it.

## The Casebook

One casebook per case. Open it with the **Casebook** button in the top bar or `Ctrl`+`Shift`+`N`; on wide screens it is a column beside the page and the desk shifts left, on narrow screens it is a full-screen sheet. `Escape` closes it and focus returns to where it was. Nine tabs, each a small form:

- **Scope**: question asked, requested by, time window (UTC), in scope, out of scope.
- **Evidence**: time (`HH:MM` or a range such as `19:05 to 19:10`), source (the query and the time-range label; filled from the desk, editable with **Edit source** or **Use current query**), observation, records (`metadata.id` list), confidence, and an optional "where to find it". Entries get stable numbers (#1, #2 ...) that are never reused.
- **Timeline**: time, fact, the Evidence # it comes from. Sorted by time, across midnight.
- **Hypotheses**: statement, status (open / supported / refuted), supporting and contradicting refs, "test next".
- **Pivots**: text and a done box. **Gaps**: text and why it matters.
- **Determination**: confirmed incident / benign activity / inconclusive, confidence, the deciding refs, a two-sentence summary.
- **Remediation**: four lists, Contain, Eradicate, Recover, Harden; each item has an action, the evidence refs it answers, an owner role and an urgency.
- **Handoff**: the engineering ticket: problem statement, affected assets and accounts, evidence refs, proposed controls, detection ideas in words, acceptance criteria, open questions. **Assemble from casebook** fills the problem, refs, controls and open questions from the other tabs; the rest is yours. This tab is the exit point to a future Cybersecurity Engineering course.

**Insert from results.** Open any record on the desk and press **Add to Casebook**: its UTC time and `metadata.id` go into the Evidence draft (a second record turns the time into a range and appends the ID), the source is filled from the current query and range if the draft had none, and focus lands in the observation box. The observation is never written for you.

**The structure check.** Every saved entry shows either *Passes the structure check* or the rules it fails, in plain language: a required field is empty; a time is not `HH:MM` UTC; no record ID, or one that is not in the dataset; a reference that does not point at an existing Evidence entry; a supported hypothesis without a supporting ref (a refuted one without a contradicting ref; an open one without a test); a remediation item or determination without evidence refs; a claim word (*proves, definitely, obviously, clearly, must have*) in an observation or fact without a record on the same entry. **Check my Casebook** in a mission's Log it block runs the same check on entries of the kind the mission asked for and also looks for the anchors it names (an IP, a time, a record ID). It is a structure check. It does not grade the quality of your thinking, and it never compares your text with a model answer.

**Export.** **Download Markdown** writes the whole casebook to a local `.md` file you start yourself. **Copy handoff ticket** writes the ticket to your clipboard on click (write-only; if the browser refuses, the Handoff tab shows the ticket as text to copy by hand). There is no import and no upload.

**Storage.** The casebook is session-only unless you tick **Remember my casebook in this browser** on the case file page. That is a separate toggle and a separate key from progress, bounded at 96 KB with a visible meter in the drawer and on the case file page. Stored notes are validated on load; anything that does not match the expected shape is ignored and left in place. **Clear this case** in the drawer footer (two presses) removes one case's casebook; the home page has the same button. Leave remembering off on a shared device, and never put real workplace values in your notes.

## The desk, in detail

- **Time range.** Changes what the query runs against and clears stale results. Answers always assume the whole night; if you check an answer with a narrower range selected, the feedback says so.
- **Feedback line.** Three kinds, never blurred: *Will not run* (your syntax is broken; the fix line says what to change), *Not run here* (valid Google syntax this trainer does not implement), and a comparison reason when the query runs but returns different evidence. A comparison failure says whether your result is too narrow, too wide, or has the same rows with different numbers, gives the counts, and lists up to three example `metadata.id` values you are missing or have extra; paste one into the editor as `metadata.id = "evt-00039"` to open that record. The IDs come from the dataset, never from what you typed. An untouched Build starter reports its `___` gap rather than an unknown field.
- **Results.** Up to 200 rows are shown. The first column of an event table has an **Open** button per row; it opens the full record below the table, moves focus there, and **Close** returns focus to the row. Click anywhere on a row to do the same with a mouse.
- **Field list.** A collapsed list of every UDM field in the dataset with its type.
- **Reset.** Restores the starter query and clears results.
- **Hints.** Up to three, free. The third is a full answer on Build and Your-turn missions. Revealing a hint moves focus to it.

## Keyboard

Everything works without a mouse. `Tab` moves through the header (including the six chapter-progress segments, each a link to its chapter, and the **Casebook** button), the lesson pane (breadcrumbs, hints, Log it, previous/next links) and then the desk (time range, editor, Run, Check, Reset, field list, result rows, answer box, analyst-call radios, Check call). `Shift`+`Tab` goes back. In the editor, `Ctrl`+`Enter` runs, `Ctrl`+`Shift`+`Enter` checks (Build and Your-turn missions), and `Tab` leaves the editor rather than inserting a tab; the hint under the editor lists all three and the casebook shortcut. Arrow keys move between analyst-call options. `Ctrl`+`Shift`+`N` opens and closes the Casebook from any page; inside it, `Left`/`Right`/`Home`/`End` move between tabs and `Escape` closes it with focus returned. Note: Chrome reserves `Ctrl`+`Shift`+`N` for a new incognito window and does not pass it to the page, so Chrome users press the Casebook button (one `Tab` stop in the header); Firefox and the test browser deliver it. The first `Tab` on any page reaches **Skip to content**, which moves focus into the page without changing the route.

## Progress

The top bar shows one segment per chapter with a bar that fills as missions complete; the current chapter is outlined, a finished chapter turns green, and each segment's accessible name reads out the count. Progress is in memory for this tab only unless you tick **Remember my points in this browser** on the home page. Remembering stores mission IDs, points from a fixed set (including the 10 Casebook points a passed Log it earns) and the highest hint level, under 16 KB, in `localStorage`. Query text and typed answers are never stored there. **Clear all progress** wipes both memory and storage. The Casebook has its own toggle and key (see above); clearing progress does not clear notes and clearing notes does not clear points. On a shared device, leave both off.

## What not to type

The dataset is fiction. Do not paste real hostnames, user IDs, addresses or queries from your workplace into the editor. The site never sends or stores them, but your browser, extensions and device can see them. Practise the query shape here; use real values only inside tools your employer authorizes.

## Reading the scores

Query 60, answer 25, analyst call 15, Casebook 10 (Watch missions have no query points; Read missions only the call and the Casebook; the first mission only the call). Course total 2,235. Points are formative: hints are free, the last hint is the answer, the Casebook check is structural, and local progress is editable. Nothing here is a credential.
