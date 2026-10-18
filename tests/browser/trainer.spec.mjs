// Browser-level checks for the Pier Nine trainer. Everything here drives dist/ through tools/serve.mjs.
// The app is deterministic (fixed dataset, no network), so there are no retries and no timing sleeps.
import { test, expect } from '@playwright/test';

const BUILD = 'C01-M02';   // Build it: starter has a gap, reference count is 14 failed logins
const WATCH = 'C01-M01';   // Watch one: complete query, 40 USER_LOGIN events for the whole night

// Collect CSP violations, console errors, page errors and every request host from the first navigation on.
async function instrument(page) {
  const log = { csp: [], errors: [], hosts: new Set() };
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', e => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  page.on('console', msg => { if (msg.type() === 'error') log.errors.push(msg.text()); });
  page.on('pageerror', err => log.errors.push(String(err)));
  page.on('request', req => log.hosts.add(new URL(req.url()).host));
  log.csp = async () => page.evaluate(() => window.__cspViolations);
  return log;
}

// Press Tab (or Shift+Tab) until the active element matches the selector. This is the only way the keyboard tests move around.
async function tabTo(page, selector, max = 80, reverse = false) {
  for (let i = 0; i < max; i++) {
    if (await page.evaluate(sel => document.activeElement?.matches(sel) ?? false, selector)) return;
    await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
  }
  throw new Error(`Tab never reached ${selector}`);
}
const active = page => page.evaluate(() => { const a = document.activeElement; return { tag: a.tagName, text: a.textContent.trim().slice(0, 40), label: a.getAttribute('aria-label') }; });

test('Build mission end to end with the keyboard only: invalid, correct, answer, analyst call, clue, next', async ({ page }) => {
  await page.goto(`#${BUILD}`);
  await expect(page.locator('h1')).toHaveText('Keep only the failures');
  await expect(page).toHaveTitle(/Keep only the failures/);
  const feedback = page.locator('.desk .feedback');
  const clue = page.locator('.clue');
  await expect(clue).toBeHidden();

  // 1. Invalid query: the enum is unquoted. Ctrl+Enter runs it.
  await tabTo(page, 'textarea.editor');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = FAIL');
  await page.keyboard.press('Control+Enter');
  await expect(feedback).toHaveClass(/bad/);
  await expect(feedback).toContainText('Will not run:');
  await expect(feedback).toHaveAttribute('role', 'status');

  // 2. Correct query: run it, then Tab to Check query and press Enter.
  await page.keyboard.press('Control+a');
  await page.keyboard.type('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"');
  await page.keyboard.press('Control+Enter');
  await expect(feedback).toHaveClass(/info/);
  await expect(page.locator('.results .summary')).toContainText('14 events');
  await page.keyboard.press('Tab');                       // Run query
  await page.keyboard.press('Tab');                       // Check query
  expect((await active(page)).text).toBe('Check query');
  await page.keyboard.press('Enter');
  await expect(feedback).toHaveClass(/ok/);
  await expect(feedback).toContainText('Query correct');
  await expect(page.locator('.scorebox span').first()).toHaveText('Query 60/60');

  // 3. Answer read from the results. Enter in the box submits it.
  await tabTo(page, 'input[type="text"]');
  await page.keyboard.type('14');
  await page.keyboard.press('Enter');
  const ansFeedback = page.locator('.part [role="status"]').first();
  await expect(ansFeedback).toHaveText('Correct.');

  // 4. Analyst call: arrow keys pick option B inside the radio group, then Tab to Check call.
  await tabTo(page, 'input[type="radio"]');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('input[type="radio"][value="B"]')).toBeChecked();
  await page.keyboard.press('Tab');
  expect((await active(page)).text).toBe('Check call');
  await page.keyboard.press('Enter');
  await expect(page.locator('.part [role="status"]').nth(1)).toContainText('Right.');

  // 5. The clue appears in the lesson pane and the change is announced to assistive tech. The mission still wants its Log it.
  await expect(clue).toBeVisible();
  await expect(clue).toContainText('Fourteen failures');
  await expect(page.locator('.scorebox')).toContainText('Casebook 0/10');
  await expect(page.locator('.scorebox')).toContainText('Log it to complete');
  await expect(page.locator('.desk .sr-only[role="status"]')).toContainText('Log it in the Casebook to complete the mission');
  await expect(page.locator('.logit')).toBeVisible();
  await expect(page.locator('#topscore')).toHaveText('100 / 4,355 pts');

  // 6. The next-mission control (in the lesson pane, before the desk in DOM order) is a real link: Enter on it navigates.
  await tabTo(page, 'a.btn[href="#C01-M07"]', 80, true);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#C01-M07$/);
  await expect(page.locator('h1')).not.toHaveText('Keep only the failures');
});

test('Changing the time range changes the results and the answer check warns about the narrower range', async ({ page }) => {
  await page.goto(`#${WATCH}`);
  await page.getByRole('button', { name: 'Run query' }).click();
  const summary = page.locator('.results .summary');
  await expect(summary).toContainText('40 events');
  await expect(summary).toContainText('Whole night');

  await page.getByLabel('Time range').selectOption('doors');
  await expect(page.locator('.results .empty')).toBeVisible();           // stale results are cleared on range change
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(summary).toContainText('Doors open');
  const text = await summary.textContent();
  const count = Number(text.match(/^([\d,]+) event/)[1].replace(',', ''));
  expect(count).toBeLessThan(40);

  await page.getByLabel('How many USER_LOGIN events are there for the whole night?').fill(String(count));
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.locator('.part [role="status"]').first()).toContainText('your time range is narrower');

  await page.getByLabel('Time range').selectOption('all');
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(summary).toContainText('40 events');
  await page.getByLabel('How many USER_LOGIN events are there for the whole night?').fill('40');
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.locator('.part [role="status"]').first()).toHaveText('Correct.');
});

test('Hints reveal one at a time, move focus to the new hint, cost nothing, and end with the full answer', async ({ page }) => {
  await page.goto(`#${BUILD}`);
  const hints = page.locator('.hints .hint');
  await expect(hints).toHaveCount(0);
  await page.getByRole('button', { name: 'Show a hint' }).click();
  await expect(hints).toHaveCount(1);
  await expect(hints.first()).toContainText('Hint 1 of 3');
  await expect(hints.first()).toBeFocused();
  await page.getByRole('button', { name: 'Show hint 2 of 3' }).click();
  await page.getByRole('button', { name: 'Show hint 3 of 3' }).click();
  await expect(hints).toHaveCount(3);
  await expect(hints.nth(2)).toBeFocused();
  await expect(hints.nth(2).locator('pre')).toContainText('security_result.action = "FAIL"');
  await expect(page.getByRole('button', { name: /Show/ })).toHaveCount(0);
  await expect(page.locator('.hints')).toContainText('Hints never cost points');
  await expect(page.locator('#topscore')).toHaveText('0 / 4,355 pts');
});

test('Record drill-down opens a full record, moves focus into it, and returns focus on close', async ({ page }) => {
  await page.goto(`#${WATCH}`);
  await page.getByRole('button', { name: 'Run query' }).click();
  const rows = page.locator('.tablewrap tbody tr');
  await expect(rows).toHaveCount(40);
  await expect(page.locator('.tablewrap tr[role]')).toHaveCount(0);       // rows keep their table semantics
  const opener = rows.first().getByRole('button', { name: /^Open record / });
  await opener.focus();
  await page.keyboard.press('Enter');
  const region = page.getByRole('region', { name: 'Full record' });
  await expect(region).toBeVisible();
  await expect(region).toBeFocused();
  const id = (await opener.getAttribute('aria-label')).replace('Open record ', '');
  await expect(region).toContainText('Full record ' + id);
  await expect(region.locator('dt', { hasText: /^metadata\.id$/ })).toHaveCount(1);
  await expect(region.locator('dd').filter({ hasText: id })).toHaveCount(1);
  await region.getByRole('button', { name: 'Close' }).click();
  await expect(region).toBeHidden();
  await expect(opener).toBeFocused();
});

test('No horizontal overflow at 320 px on the home, chapter, mission, results and about pages', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const page = await context.newPage();
  const overflow = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  for (const hash of ['', '#C01', `#${BUILD}`, '#about']) {
    await page.goto('./' + hash);
    await expect(page.locator('h1')).toBeVisible();
    expect(await overflow(), hash || 'home').toBeLessThanOrEqual(0);
  }
  await page.goto(`#${WATCH}`);
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(page.locator('.tablewrap tbody tr')).toHaveCount(40);
  await page.locator('.fields summary').click();
  await page.getByRole('button', { name: 'Show a hint' }).click();
  expect(await overflow(), 'mission with results, field list and hint').toBeLessThanOrEqual(0);
  // The results table scrolls inside its own box rather than widening the page.
  const inner = await page.locator('.tablewrap').evaluate(n => n.scrollWidth > n.clientWidth);
  expect(inner).toBe(true);
  await context.close();
});

test('Reduced motion: no transitions, animations or smooth scrolling anywhere on a mission page', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`#${BUILD}`);
  await page.locator('textarea.editor').fill('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"');   // the starter's ___ gap no longer runs
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(page.locator('.results .summary')).toBeVisible();
  const report = await page.evaluate(() => {
    const bad = [];
    const zero = v => v.split(',').every(s => parseFloat(s) === 0);
    for (const n of document.querySelectorAll('*')) {
      const cs = getComputedStyle(n);
      if (!zero(cs.transitionDuration) || !zero(cs.animationDuration) || cs.scrollBehavior === 'smooth') bad.push(n.tagName + '.' + n.className);
    }
    return { matches: matchMedia('(prefers-reduced-motion: reduce)').matches, bad };
  });
  expect(report.matches).toBe(true);
  expect(report.bad).toEqual([]);
  await context.close();
});

test('Zero CSP violations, console errors or non-loopback requests across routing and every interaction', async ({ page, baseURL }) => {
  const log = await instrument(page);
  await page.goto('./');
  await expect(page.locator('h1')).toHaveText('Static on Pier Nine');
  await page.getByRole('link', { name: 'Open the case →' }).click();
  await expect(page).toHaveURL(/#C01-M00$/);                                 // the course now opens on the note-keeping read mission
  await page.getByRole('link', { name: 'Case file' }).first().click();
  await page.locator('a.chapter-card').first().click();
  await expect(page).toHaveURL(/#C01$/);
  await page.locator('.list').getByRole('link', { name: /Keep only the failures/ }).click();   // the mission map carries a second link to the same mission
  await page.getByRole('button', { name: 'Run query' }).click();
  await page.getByRole('button', { name: 'Check query' }).click();
  await page.getByRole('button', { name: 'Show a hint' }).click();
  await page.locator('textarea.editor').fill('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"');
  await page.getByRole('button', { name: 'Check query' }).click();
  await page.locator('.tablewrap tbody tr').first().click();
  await expect(page.getByRole('region', { name: 'Full record' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByRole('link', { name: 'What this is' }).click();
  await expect(page).toHaveURL(/#about$/);
  await page.goto('#C06');
  await page.goto('#not-a-real-route');
  await expect(page.locator('h1')).toHaveText('Static on Pier Nine');
  await page.getByLabel(/Remember my points/).check();
  await page.getByLabel(/Remember my points/).uncheck();
  await page.getByLabel(/Remember my casebook/).check();
  await page.getByLabel(/Remember my casebook/).uncheck();
  await page.keyboard.press('Alt+Shift+C');
  await expect(page.locator('#casebook')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await log.csp()).toEqual([]);
  expect(log.errors).toEqual([]);
  expect([...log.hosts]).toEqual([new URL(baseURL).host]);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("connect-src 'none'");
});

test('Accessibility: names, focus order, headings, live regions and the skip link', async ({ page }) => {
  await page.goto(`#${BUILD}`);
  await page.getByRole('button', { name: 'Run query' }).click();

  // Every form control has an accessible name.
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea, button')].filter(n => {
    if (n.getAttribute('aria-label') || n.getAttribute('aria-labelledby')) return false;
    if (n.closest('label')?.textContent.trim()) return false;
    if (n.id && document.querySelector(`label[for="${n.id}"]`)) return false;
    return !n.textContent.trim();
  }).map(n => n.outerHTML.slice(0, 80)));
  expect(unnamed).toEqual([]);

  // No interactive element nested in another, and no table row pretending to be a button.
  expect(await page.locator('a button, button a, a a, button button').count()).toBe(0);
  expect(await page.locator('tr[role], tr[tabindex]').count()).toBe(0);
  expect(await page.locator('[role="radiogroup"][aria-labelledby]').count()).toBe(1);

  // Headings never skip a level.
  const levels = await page.locator('h1, h2, h3, h4').evaluateAll(hs => hs.map(h => Number(h.tagName[1])));
  expect(levels[0]).toBe(1);
  for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `heading ${i}`).toBeLessThanOrEqual(1);

  // Focus order on the desk runs editor, Run, Check, Reset, then into the results.
  await page.locator('textarea.editor').focus();
  const order = [];
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); order.push((await active(page)).text || (await active(page)).label); }
  expect(order).toEqual(['Run query', 'Check query', 'Reset', 'Field list for this dataset']);

  // Live regions exist for query feedback, answer feedback, call feedback and the completion announcer.
  expect(await page.locator('.desk [role="status"]').count()).toBe(4);
  expect(await page.locator('#topscore[aria-live="polite"]').count()).toBe(1);

  // The skip link moves focus to main without changing the route. Shift+Tab walks back through the header to reach it.
  await tabTo(page, 'a.skip', 120, true);
  expect((await active(page)).text).toBe('Skip to content');
  await page.keyboard.press('Enter');
  expect((await active(page)).tag).toBe('MAIN');
  await expect(page).toHaveURL(/#C01-M02$/);
  await expect(page.locator('h1')).toHaveText('Keep only the failures');

  // Every mission page carries its own document title.
  await page.goto('#about');
  await expect(page).toHaveTitle(/^What this is · /);
});

// Seed a validated progress record so a test can start from a chosen state without clicking through 48 missions.
// The store only accepts mission IDs it knows and point values from its fixed set, so this is the same data a real
// run would have written.
async function seedProgress(page, ids, full = true) {
  await page.addInitScript(({ ids, full }) => {
    const missions = {};
    for (const [id, kind, logIt] of ids) missions[id] = { q: kind === 'build' || kind === 'solo' ? 60 : 0, a: kind === 'read' ? 0 : 25, c: 15, cb: logIt ? 10 : 0, h: 0 };
    if (full) localStorage.setItem('pier9.progress.v1', JSON.stringify({ v: 1, missions }));
  }, { ids, full });
}

test('Starter gap, wrong-query feedback with example record IDs, and the keyboard check shortcut', async ({ page }) => {
  await page.goto(`#${BUILD}`);
  const feedback = page.locator('.desk .feedback');
  // 1. Running the untouched starter names the gap instead of an unknown field.
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(feedback).toContainText('The starter still has a ___ gap.');
  // 2. A too-narrow query: one-sided title, up to three example IDs, a way to open one, and nothing the learner typed.
  const editor = page.locator('textarea.editor');
  await editor.fill('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"\nprincipal.user.userid = "marco.vela" // MY-OWN-NOTE');
  await editor.press('Control+Shift+Enter');                                   // checks without touching the mouse
  await expect(feedback).toHaveClass(/bad/);
  await expect(feedback).toContainText('misses events the reference returns');
  await expect(feedback).toContainText('You have 3 events; the reference has 14.');
  await expect(feedback).toContainText(/Missing from yours, for example: "evt-\d{5}", "evt-\d{5}", "evt-\d{5}"\./);
  await expect(feedback).toContainText(/Open one with metadata\.id = "evt-\d{5}"/);
  await expect(feedback).not.toContainText('MY-OWN-NOTE');
  // 3. A too-wide query gets the other title and extra IDs; the example is a record the learner can open.
  await editor.fill('metadata.event_type = "USER_LOGIN"');
  await editor.press('Control+Shift+Enter');
  await expect(feedback).toContainText('returns events the reference does not');
  await expect(feedback).toContainText('Extra in yours, for example:');
  const id = (await feedback.textContent()).match(/Extra in yours, for example: "([^"]+)"/)[1];
  await editor.fill(`metadata.id = "${id}"`);
  await editor.press('Control+Enter');
  await expect(page.locator('.results .summary')).toContainText('1 event');
  await expect(page.locator('.tablewrap tbody tr')).toHaveCount(1);
  // 4. The shortcut hint beside the editor documents all three keys and is linked to the editor.
  const help = page.locator('#editor-help-' + BUILD);
  await expect(help).toContainText('runs');
  await expect(help).toContainText('checks');
  await expect(help).toContainText('leaves the editor');
  expect(await editor.getAttribute('aria-describedby')).toBe('editor-help-' + BUILD);
  // 5. Wrong answers say where in the results the value is read from, without giving it.
  await editor.fill('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"');
  await editor.press('Control+Enter');
  await page.getByLabel('How many failed login events are there?').fill('13');
  await page.getByRole('button', { name: 'Check answer' }).click();
  const ans = page.locator('.part [role="status"]').first();
  await expect(ans).toContainText('The answer is the count in the results bar above the table');
  await expect(ans).not.toContainText('14');
});

test('Top-bar chapter progress updates as a mission completes, and the chapter page carries a recap card', async ({ page }) => {
  await page.goto('#C01');
  const seg = page.locator('#chapterprog .chap');
  await expect(seg).toHaveCount(6);
  await expect(seg.first()).toHaveAttribute('aria-current', 'page');
  await expect(seg.first()).toHaveAttribute('aria-label', 'Chapter 1, Dead air at 03:10: 0 of 11 missions complete');
  await expect(seg.nth(1)).not.toHaveAttribute('aria-current', 'page');
  const recap = page.getByRole('region', { name: 'Chapter recap' });
  await expect(recap).toContainText('By the end of this chapter you will be able to');
  await expect(recap.locator('li')).toHaveCount(6);
  await expect(recap).toContainText('0 of 11 missions complete so far.');
  // The mission map: one link per mission, coloured by kind, nothing complete yet; the legend names every kind in the chapter.
  const map = page.getByRole('region', { name: 'Mission map' });
  await expect(map).toContainText('Mission map · 0 of 11 complete');
  await expect(map.locator('.seg')).toHaveCount(11);
  await expect(map.locator('.seg.done')).toHaveCount(0);
  await expect(map.locator('.seg').nth(1)).toHaveAttribute('href', `#${WATCH}`);
  await expect(map.locator('.seg').nth(1)).toHaveAttribute('aria-label', 'Mission 2, Open the login log, Watch one, not started');
  await expect(map.locator('.legend li')).toHaveCount(4);
  // Complete the Watch mission C01-M01: answer 40, option C, then its Log it (the Scope) in the Casebook.
  await page.goto(`#${WATCH}`);
  await expect(seg.first()).toHaveAttribute('aria-label', /0 of 11/);
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(page.locator('.logit')).toBeHidden();
  await page.getByLabel('How many USER_LOGIN events are there for the whole night?').fill('40');
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.locator('.logit')).toBeVisible();                       // a Watch mission unlocks its Log it once the answer is read
  await page.locator('input[type="radio"][value="C"]').check();
  await page.getByRole('button', { name: 'Check call' }).click();
  await expect(page.locator('.scorebox')).toContainText('Log it to complete');
  await expect(seg.first()).toHaveAttribute('aria-label', /0 of 11/);
  await page.locator('.logit').getByRole('button', { name: 'Check my Casebook' }).click();
  await expect(page.locator('.logit .feedback')).toContainText('No scope yet.');
  await page.locator('.logit').getByRole('button', { name: 'Open Casebook: Scope' }).click();
  const cb = page.locator('#casebook');
  await expect(cb.getByRole('tab', { name: 'Scope' })).toHaveAttribute('aria-selected', 'true');
  await cb.getByRole('tab', { name: 'FreeForm' }).waitFor();                // the FreeForm tab sits between Scope and Evidence
  await cb.locator('#cb-name').fill('Pledge Night static');                // the investigation name is the first field; the Scope check needs it
  await cb.locator('#cb-scope-question').fill('Everyone who touched a keyboard tonight.');
  await cb.locator('#cb-scope-requestedBy').fill('Odalys Reyes');
  await cb.locator('#cb-scope-window').fill('18:00 to 06:00');
  await cb.locator('#cb-scope-inScope').fill('Login, email, process and network activity on the pier.');
  await cb.locator('#cb-scope-outScope').fill('Naming a person.');
  await cb.getByRole('button', { name: 'Save' }).click();
  await expect(cb.locator('.cbstatus')).toContainText('Scope saved and passes the structure check.');
  await page.keyboard.press('Escape');
  await page.locator('.logit').getByRole('button', { name: 'Check my Casebook' }).click();
  await expect(page.locator('.logit .feedback')).toContainText('Logged.');
  await expect(page.locator('.scorebox')).toContainText('Mission complete');
  await expect(page.locator('.desk .sr-only[role="status"]')).toContainText('Mission complete');
  await expect(seg.first()).toHaveAttribute('aria-label', 'Chapter 1, Dead air at 03:10: 1 of 11 missions complete');
  await expect(seg.first()).toHaveClass(/partial/);
  await page.goto('#C01');
  await expect(recap).toContainText('1 of 11 missions complete so far.');
  await expect(map).toContainText('Mission map · 1 of 11 complete');
  await expect(map.locator('.seg.done')).toHaveCount(1);
  await expect(map.locator('.seg').nth(1)).toHaveClass(/done/);
  await expect(map.locator('.seg').nth(1)).toHaveAttribute('aria-label', /complete$/);
  await map.locator('.seg').nth(2).click();
  await expect(page).toHaveURL(/#C01-M02$/);
  await page.goto('#C01');
  // Chapter links in the bar are real links.
  await seg.nth(3).click();
  await expect(page).toHaveURL(/#C04$/);
  await expect(seg.nth(3)).toHaveAttribute('aria-current', 'page');
});

test('Case-closed page: lists what is left while the case is open, and the three handoff columns once every mission is complete', async ({ browser }) => {
  // Open: nothing complete.
  const open = await (await browser.newContext()).newPage();
  await open.goto('#closed');
  await expect(open.locator('h1')).toHaveText('The handoff is not written yet');
  await expect(open.locator('.list li')).toHaveCount(49);
  await expect(open.getByRole('region', { name: 'Casebook' })).toContainText('Not written yet');
  await expect(open.getByRole('region', { name: 'Facts' })).toHaveCount(0);
  await expect(open.getByRole('link', { name: 'Next open mission →' })).toHaveAttribute('href', '#C01-M00');
  await expect(open.locator('.skills .skill')).toHaveCount(6);
  await expect(open.locator('.skills .skill.complete')).toHaveCount(0);
  await open.context().close();

  // Closed: every mission recorded as complete through the same validated store a real run writes to.
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const ids = await (async () => { const p = await ctx.newPage(); await p.goto('./'); const r = await p.evaluate(async () => { const { CONTENT } = await import('./bundle.js'); return CONTENT.chapters.flatMap(c => c.missions.map(m => [m.id, m.kind, Boolean(m.logIt)])); }); await p.close(); return r; })();
  await seedProgress(page, ids);
  await page.goto('./');
  await expect(page.locator('#topscore')).toHaveText('4,355 / 4,355 pts');
  await expect(page.locator('#chapterprog .chap.done')).toHaveCount(6);
  await page.getByRole('link', { name: 'Read the case-closed handoff →' }).click();
  await expect(page).toHaveURL(/#closed$/);
  await expect(page.locator('h1')).toHaveText('The handoff');
  for (const name of ['Facts', 'Hypotheses', 'Gaps']) await expect(page.getByRole('region', { name })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Facts' })).toContainText('19:21:04 success');
  await expect(page.getByRole('region', { name: 'Hypotheses' })).toContainText('fake portal');
  await expect(page.getByRole('region', { name: 'Gaps' })).toContainText('Encoded command not decoded');
  expect(await page.getByRole('region', { name: 'Facts' }).locator('li').count()).toBeGreaterThanOrEqual(8);
  await expect(page.locator('.skills .skill.complete')).toHaveCount(6);
  await expect(page.locator('.list')).toHaveCount(0);
  // The last mission and the chapter page now point at the closed page, and the chapter recap turns into a record.
  await page.goto('#C06-M04');
  await expect(page.getByRole('link', { name: 'Case closed →' })).toHaveAttribute('href', '#closed');
  await page.goto('#C06');
  await expect(page.getByRole('region', { name: 'Chapter recap' })).toContainText('Chapter complete · you can now');
  await expect(page.getByRole('link', { name: 'Case closed →' })).toHaveAttribute('href', '#closed');
  // Still nothing but loopback and no CSP violations on the new page.
  const csp = await page.evaluate(() => new Promise(res => { let n = 0; document.addEventListener('securitypolicyviolation', () => n++); setTimeout(() => res(n), 50); }));
  expect(csp).toBe(0);
  await ctx.close();
});

test('Density sample: a min/max mission shows timestamp cells as clock times, a Read mission on wrong queries needs no desk, and a Your-turn timeline query grades by execution', async ({ page }) => {
  // C05-M04: fill the gap, run, and the $first / $last cells read as UTC clock times with the raw seconds beside them.
  await page.goto('#C05-M04');
  await expect(page.locator('h1')).toHaveText('First and last');
  await expect(page.locator('.crumbs')).toContainText('Mission 2 of 7');
  const editor = page.locator('textarea.editor');
  await editor.fill((await editor.inputValue()).replace('___', 'min'));
  await page.getByRole('button', { name: 'Run query' }).click();
  const table = page.locator('.results table');
  await expect(table.locator('th')).toHaveText(['principal.hostname', '$first', '$last']);
  await expect(table.locator('tbody td').nth(1)).toHaveText(/^03-13 19:40:05 \(\d{10}\)$/);
  await expect(table.locator('tbody td').nth(2)).toHaveText(/^03-14 05:50:06 \(\d{10}\)$/);
  await page.getByRole('button', { name: 'Check query' }).click();
  await expect(page.locator('.desk .feedback')).toContainText('Query correct');
  await page.getByLabel(/clock time is in the \$first column/).fill('19:40');
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.locator('.part [role="status"]').first()).toContainText('Correct.');
  // A plain sum column stays a number.
  await editor.fill('metadata.event_type = "NETWORK_CONNECTION"\nmatch:\n  principal.hostname\noutcome:\n  $bytes = sum(network.sent_bytes)\norder:\n  $bytes desc\nlimit:\n  1');
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(table.locator('tbody td').nth(1)).toHaveText('48,345,375');

  // C01-M10: a Read mission; the desk is disabled, the three queries are in the side-by-side, the call completes the investigation.
  await page.goto('#C01-M10');
  await expect(page.locator('h1')).toHaveText('Spot the wrong query');
  await expect(page.locator('textarea.editor')).toBeDisabled();
  await expect(page.getByText('Side by side')).toBeVisible();
  await expect(page.locator('.explain li')).toHaveCount(3);
  await expect(page.locator('.logit')).toBeHidden();
  await page.locator('input[type="radio"][value="C"]').check();
  await page.getByRole('button', { name: 'Check call' }).click();
  await expect(page.locator('.part [role="status"]').last()).toContainText('Right.');
  await expect(page.locator('.logit')).toBeVisible();
  await expect(page.locator('.logit')).toContainText('This mission earned: a pivot');

  // C06-M06: a Your-turn mission with no event type; a narrower query fails with the one-sided reason, the full one passes.
  await page.goto('#C06-M06');
  await expect(page.locator('h1')).toHaveText('Everything from one address');
  const ed = page.locator('textarea.editor');
  await expect(ed).toHaveValue('');
  await ed.fill('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"\nprincipal.ip = "198.51.100.23"');
  await ed.press('Control+Shift+Enter');
  await expect(page.locator('.desk .feedback')).toContainText('misses events');
  await expect(page.locator('.desk .feedback .examples')).toContainText('evt-00094');
  await ed.fill('principal.ip = "198.51.100.23"');
  await ed.press('Control+Shift+Enter');
  await expect(page.locator('.desk .feedback')).toContainText('Query correct');
  await expect(page.locator('.results .summary')).toContainText('8 events');
  // The chapter page's mission map reflects the partial progress on this mission.
  await page.goto('#C06');
  const seg = page.getByRole('region', { name: 'Mission map' }).locator('.seg[href="#C06-M06"]');
  await expect(seg).toHaveClass(/partial/);
  await expect(seg).toHaveAttribute('aria-label', 'Mission 4, Everything from one address, Your turn, in progress');
});
