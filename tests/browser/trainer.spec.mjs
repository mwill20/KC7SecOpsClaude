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
  const feedback = page.locator('.feedback');
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

  // 5. The clue appears in the lesson pane and the change is announced to assistive tech.
  await expect(clue).toBeVisible();
  await expect(clue).toContainText('Fourteen failures');
  await expect(page.locator('.scorebox')).toContainText('Mission complete');
  await expect(page.locator('.desk .sr-only[role="status"]')).toContainText('Mission complete');
  await expect(page.locator('#topscore')).toHaveText('100 / 1,970 pts');

  // 6. The next-mission control (in the lesson pane, before the desk in DOM order) is a real link: Enter on it navigates.
  await tabTo(page, 'a.btn[href="#C01-M03"]', 80, true);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#C01-M03$/);
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
  await expect(page.locator('#topscore')).toHaveText('0 / 1,970 pts');
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
    await page.goto('/' + hash);
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

test('Zero CSP violations, console errors or non-loopback requests across routing and every interaction', async ({ page }) => {
  const log = await instrument(page);
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Static on Pier Nine');
  await page.getByRole('link', { name: 'Open the case →' }).click();
  await expect(page).toHaveURL(/#C01-M01$/);
  await page.getByRole('link', { name: 'Case file' }).first().click();
  await page.locator('a.chapter-card').first().click();
  await expect(page).toHaveURL(/#C01$/);
  await page.getByRole('link', { name: /Keep only the failures/ }).click();
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
  await page.getByRole('checkbox').check();
  await page.getByRole('checkbox').uncheck();
  expect(await log.csp()).toEqual([]);
  expect(log.errors).toEqual([]);
  expect([...log.hosts]).toEqual(['127.0.0.1:4187']);
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
