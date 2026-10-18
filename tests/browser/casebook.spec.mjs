// Browser checks for the Casebook: the drawer, Insert from results, the note check, export, storage and the brief.
// Deterministic like the rest of the suite: no retries, no sleeps.
import { test, expect } from '@playwright/test';

const SOLO = 'C01-M05';   // Your turn: pledge-desk logins; its Log it asks for the burst as evidence
const REF = 'metadata.event_type = "USER_LOGIN"\nprincipal.user.userid = "pledge-desk"';
const KEY = 'pier9.casebook.v1';
const drawer = page => page.locator('#casebook');
const active = page => page.evaluate(() => { const a = document.activeElement; return { tag: a.tagName, id: a.id, text: a.textContent.trim().slice(0, 40), label: a.getAttribute('aria-label') }; });

test('Drawer: Alt+Shift+C and the top-bar button open it beside the desk, arrows move between tabs, Escape closes and focus returns', async ({ page }) => {
  await page.goto(`#${SOLO}`);
  const cb = drawer(page);
  await expect(cb).toBeHidden();
  await page.locator('textarea.editor').focus();
  await page.keyboard.press('Alt+Shift+C');
  await expect(cb).toBeVisible();
  await expect(page.locator('#casebook-toggle')).toHaveAttribute('aria-expanded', 'true');
  expect((await active(page)).id).toBe('cb-title');
  await expect(cb.getByRole('tab')).toHaveCount(9);
  await expect(cb.getByRole('tab', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true');
  // Wide layout: the desk shifts left of the drawer; nothing is covered.
  const desk = await page.locator('.desk').boundingBox(); const box = await cb.boundingBox();
  expect(desk.x + desk.width).toBeLessThanOrEqual(box.x + 1);
  expect(await page.evaluate(() => document.body.classList.contains('cb-open'))).toBe(true);
  // Tabs: arrow keys move selection and focus; the panel follows.
  await cb.getByRole('tab', { name: 'Evidence' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(cb.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true');
  await expect(cb.getByRole('tab', { name: 'Timeline' })).toBeFocused();
  await expect(cb.getByRole('tabpanel')).toContainText('Facts in clock order');
  await page.keyboard.press('End');
  await expect(cb.getByRole('tab', { name: 'Handoff' })).toHaveAttribute('aria-selected', 'true');
  await expect(cb.getByRole('tabpanel')).toContainText('Cybersecurity Engineering');
  // Every control inside the drawer has a name and nothing interactive is nested.
  const unnamed = await cb.evaluate(root => [...root.querySelectorAll('input, select, textarea, button')].filter(n => !(n.getAttribute('aria-label') || n.getAttribute('aria-labelledby') || n.closest('label')?.textContent.trim() || (n.id && root.querySelector(`label[for="${n.id}"]`)) || n.textContent.trim())).map(n => n.outerHTML.slice(0, 80)));
  expect(unnamed).toEqual([]);
  expect(await cb.locator('a button, button a, button button, label label').count()).toBe(0);
  // Escape closes and focus goes back to the editor it came from.
  await page.keyboard.press('Escape');
  await expect(cb).toBeHidden();
  await expect(page.locator('textarea.editor')).toBeFocused();
  await expect(page.locator('#casebook-toggle')).toHaveAttribute('aria-expanded', 'false');
  // The button toggles too, and Close returns focus to it.
  await page.locator('#casebook-toggle').click();
  await expect(cb).toBeVisible();
  await cb.getByRole('button', { name: 'Close casebook' }).click();
  await expect(cb).toBeHidden();
  await expect(page.locator('#casebook-toggle')).toBeFocused();
  // The shortcut is documented beside the editor's other shortcuts.
  await expect(page.locator('#editor-help-' + SOLO)).toContainText('casebook');
});

test('Insert from results drafts the evidence entry, the note check passes, Log it earns the Casebook points, and a claim without a record is named', async ({ page }) => {
  await page.goto(`#${SOLO}`);
  const cb = drawer(page), logit = page.locator('.logit');
  await expect(logit).toBeHidden();
  const editor = page.locator('textarea.editor');
  await editor.fill(REF);
  await editor.press('Control+Shift+Enter');
  await expect(page.locator('.desk .feedback')).toContainText('Query correct');
  await expect(logit).toBeVisible();
  await expect(logit).toContainText('This mission earned: an evidence entry');
  await expect(logit).toContainText('198.51.100.23');
  await expect(logit).toContainText('does not grade the quality of your thinking');
  await expect(page.locator('.scorebox')).toContainText('Casebook 0/10');
  await expect(page.locator('.clue')).toBeHidden();

  // 1. Open the first record (19:05, evt-00039) and add it: the drawer opens on Evidence with time and ID filled, observation empty.
  const rows = page.locator('.tablewrap tbody tr');
  await expect(rows).toHaveCount(10);
  await rows.nth(0).getByRole('button', { name: /^Open record / }).click();
  const region = page.getByRole('region', { name: 'Full record' });
  await region.getByRole('button', { name: /Add record evt-00039 to the Casebook/ }).click();
  await expect(cb).toBeVisible();
  await expect(cb.getByRole('tab', { name: /^Evidence/ })).toHaveAttribute('aria-selected', 'true');
  await expect(cb.locator('#cb-evidence-time')).toHaveValue('19:05');
  await expect(cb.locator('#cb-evidence-records')).toHaveValue('evt-00039');
  await expect(cb.locator('#cb-evidence-observation')).toHaveValue('');
  await expect(cb.locator('#cb-evidence-observation')).toBeFocused();
  await expect(cb.locator('.cbfield .source pre')).toContainText('principal.user.userid = "pledge-desk"');
  await expect(cb.locator('.cbfield .source')).toContainText('Whole night');
  await expect(cb.getByRole('button', { name: 'Edit source' })).toBeVisible();
  await expect(cb.locator('.cbstatus')).toContainText('Added evt-00039 at 19:05 UTC');

  // 2. A second record (19:21, evt-00094) widens the time into a range and appends the ID. The drawer closes with Escape and focus returns to the desk.
  await page.keyboard.press('Escape');
  await expect(cb).toBeHidden();
  await rows.nth(7).getByRole('button', { name: /^Open record / }).click();
  await region.getByRole('button', { name: /Add record evt-00094 to the Casebook/ }).click();
  await expect(cb.locator('#cb-evidence-time')).toHaveValue('19:05 to 19:21');
  await expect(cb.locator('#cb-evidence-records')).toHaveValue('evt-00039, evt-00094');

  // 3. The learner writes the observation and saves. The entry passes the structure check.
  await cb.locator('#cb-evidence-observation').fill('Seven FAIL events for pledge-desk from 198.51.100.23 through VPN-GW-01 with a blank hostname, then an ALLOW from the same address at 19:21.');
  await cb.locator('#cb-evidence-confidence').selectOption('high');
  await cb.getByRole('button', { name: 'Add entry' }).click();
  const entries = cb.locator('.entry');
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText('#1 · 19:05 to 19:21 · high');
  await expect(entries.first()).toContainText('Passes the structure check.');
  await expect(cb.locator('.cbstatus')).toContainText('Evidence #1 saved and passes the structure check.');
  await expect(entries.first()).toBeFocused();
  await expect(cb.getByRole('tab', { name: 'Evidence, 1 entry' })).toBeVisible();

  // 4. Log it: the check reads the casebook and awards the points. The mission is not complete until the other parts are.
  await page.keyboard.press('Escape');
  await logit.getByRole('button', { name: 'Check my Casebook' }).click();
  await expect(logit.locator('.feedback')).toHaveClass(/ok/);
  await expect(logit.locator('.feedback')).toContainText('Logged. Evidence #1 passes the structure check');
  await expect(page.locator('.scorebox')).toContainText('Casebook 10/10');
  await expect(page.locator('#topscore')).toHaveText('70 / 4,355 pts');

  // 5. Should-fail: a second entry with a claim word and no record fails with the claim rule and the records rule, in plain language.
  await page.keyboard.press('Alt+Shift+C');
  await cb.locator('#cb-evidence-time').fill('19:30');
  await cb.getByRole('button', { name: 'Use current query' }).click();
  await cb.locator('#cb-evidence-observation').fill('This proves the pledge desk was brute-forced.');
  await cb.locator('#cb-evidence-confidence').selectOption('medium');
  await cb.getByRole('button', { name: 'Add entry' }).click();
  await expect(entries).toHaveCount(2);
  const second = entries.nth(1);
  await expect(second).toContainText('#2 · 19:30');
  await expect(second.getByRole('list', { name: 'Structure check' })).toContainText('Cite at least one metadata.id from your results.');
  await expect(second.getByRole('list', { name: 'Structure check' })).toContainText('"proves" is a claim');
  // A hypothesis marked supported without a reference is named too.
  await cb.getByRole('tab', { name: 'Hypotheses' }).click();
  await cb.locator('#cb-hypothesis-statement').fill('An outside party guessed the shared password.');
  await cb.locator('#cb-hypothesis-status').selectOption('supported');
  await cb.getByRole('button', { name: 'Add entry' }).click();
  await expect(cb.locator('.entry').first()).toContainText('A supported hypothesis needs at least one supporting Evidence reference.');
  // Deleting is two presses.
  await cb.locator('.entry').first().getByRole('button', { name: 'Delete entry' }).click();
  await cb.locator('.entry').first().getByRole('button', { name: 'Delete entry' }).click();
  await expect(cb.getByRole('tabpanel')).toContainText('No hypotheses yet.');
});

test('Export: Download Markdown produces a local .md built from the entries; Copy handoff ticket writes the clipboard and reports it', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const hosts = new Set(); page.on('request', r => hosts.add(new URL(r.url()).host));
  await page.goto('./');
  await page.getByRole('button', { name: 'Open the Casebook' }).click();
  const cb = drawer(page);
  await cb.getByRole('tab', { name: 'Gaps' }).click();
  await cb.locator('#cb-gap-text').fill('No email body or attachment analysis tonight.');
  await cb.locator('#cb-gap-why').fill('Cannot say what the lure asked for.');
  await cb.getByRole('button', { name: 'Add entry' }).click();
  await expect(cb.locator('.entry')).toHaveCount(1);
  const [download] = await Promise.all([page.waitForEvent('download'), cb.getByRole('button', { name: 'Download Markdown' }).click()]);
  expect(download.suggestedFilename()).toBe('casebook-pier-nine.md');
  const text = await new Promise(async (resolve, reject) => { const chunks = []; const s = await download.createReadStream(); s.on('data', c => chunks.push(c)); s.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); s.on('error', reject); });
  expect(text).toMatch(/^# Casebook: Static on Pier Nine/);
  expect(text).toContain('## Gaps\n\n- No email body or attachment analysis tonight.\n  - Why it matters: Cannot say what the lure asked for.');
  expect(text).toContain('Engineering handoff: Static on Pier Nine');
  await expect(cb.locator('.cbstatus')).toContainText('Downloaded casebook-pier-nine.md');
  await cb.getByRole('button', { name: 'Copy handoff ticket' }).click();
  await expect(cb.locator('.cbstatus')).toContainText('copied to the clipboard');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^Engineering handoff: Static on Pier Nine\nDetermination: \(not written\)/);
  expect([...hosts]).toEqual([new URL(baseURL).host]);
  await ctx.close();
});

test('Storage: with remembering off nothing reaches localStorage; the home toggle writes and removes the casebook key apart from progress; hostile stored state is ignored and left in place', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('./');
  const stored = () => page.evaluate(k => localStorage.getItem(k), KEY);
  await page.getByRole('button', { name: 'Open the Casebook' }).click();
  const cb = drawer(page);
  await cb.getByRole('tab', { name: 'Pivots' }).click();
  await cb.locator('#cb-pivot-text').fill('Check the mail gateway before 19:05 for a lure.');
  await cb.getByRole('button', { name: 'Add entry' }).click();
  await expect(cb.locator('.entry')).toHaveCount(1);
  expect(await stored()).toBeNull();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await expect(cb.locator('.cbfoot')).toContainText('Session only');
  await page.keyboard.press('Escape');
  const toggle = page.getByLabel(/Remember my casebook in this browser/);
  await toggle.check();
  expect(await stored()).toContain('Check the mail gateway');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([KEY]);              // progress stays separate and untouched
  await expect(page.getByRole('img', { name: /of 96\.0 KB used$/ })).toBeVisible();
  await toggle.uncheck();
  expect(await stored()).toBeNull();
  await page.context().close();

  // Hostile stored state: a shape the validator rejects is not loaded, remembering stays off, and the blob is left as it was.
  const hostile = JSON.stringify({ v: 1, cases: { 'pier-nine': { evidence: [{ id: 'e1', n: 1, observation: '<img src=x onerror=alert(1)>', onclick: 'alert(1)' }] } } });
  const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
  await p2.addInitScript(([k, v]) => localStorage.setItem(k, v), [KEY, hostile]);
  const errors = []; p2.on('pageerror', e => errors.push(String(e))); p2.on('dialog', d => { errors.push('dialog'); d.dismiss(); });
  await p2.goto('./');
  await expect(p2.getByLabel(/Remember my casebook in this browser/)).not.toBeChecked();
  await p2.getByRole('button', { name: 'Open the Casebook' }).click();
  await expect(drawer(p2).getByRole('tabpanel')).toContainText('No evidence yet.');
  expect(await p2.evaluate(k => localStorage.getItem(k), KEY)).toBe(hostile);
  expect(errors).toEqual([]);
  await ctx2.close();
});

test('320 px: the casebook is a full-screen sheet with no horizontal overflow on any tab', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const page = await context.newPage();
  const overflow = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  await page.goto(`#${SOLO}`);
  await page.locator('#casebook-toggle').click();
  const cb = drawer(page);
  await expect(cb).toBeVisible();
  await expect(cb).toHaveAttribute('aria-modal', 'true');
  const box = await cb.boundingBox();
  expect(box.width).toBe(320); expect(box.x).toBe(0);
  for (const name of ['Scope', 'Evidence', 'Timeline', 'Hypotheses', 'Pivots', 'Gaps', 'Determination', 'Remediation', 'Handoff']) {
    await cb.getByRole('tab', { name }).click();
    expect(await overflow(), name).toBeLessThanOrEqual(0);
    expect(await cb.evaluate(n => n.scrollWidth - n.clientWidth), name + ' sheet').toBeLessThanOrEqual(0);
    expect(await cb.textContent(), name + ' renders no stray null/undefined').not.toMatch(/\bnull\b|\bundefined\b/);
  }
  await cb.getByRole('tab', { name: 'Evidence' }).click();
  await cb.getByRole('button', { name: 'Edit source' }).click();
  await cb.locator('#cb-evidence-observation').fill('A long observation with a long token 203.0.113.44/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa that must wrap.');
  await cb.getByRole('button', { name: 'Add entry' }).click();
  expect(await overflow(), 'with an entry').toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');
  await expect(cb).toBeHidden();
  expect(await overflow(), 'closed').toBeLessThanOrEqual(0);
  await context.close();
});

test('The handoff mission assembles the brief from the casebook beside the model, and the case-closed page shows the determination and ticket', async ({ page }) => {
  await page.goto('#C06-M04');
  const brief = page.getByRole('region', { name: 'Your brief beside the model' });
  await expect(brief).toBeVisible();
  await expect(brief).toContainText('Nothing logged for facts yet.');
  await expect(brief.getByRole('link', { name: 'C01-M02' })).toBeVisible();
  await expect(brief.getByRole('link', { name: 'C06-M03' })).toBeVisible();
  await expect(brief).toContainText('Confirmed incident, high confidence');                 // the model column
  expect(await brief.locator('.brief').count()).toBe(6);
  // The analyst call stays fixed-choice; the Log it unlocks after it and asks for the handoff.
  await page.locator('input[type="radio"][value="B"]').check();
  await page.getByRole('button', { name: 'Check call' }).click();
  await expect(page.locator('.logit')).toBeVisible();
  await expect(page.locator('.logit')).toContainText('This mission earned: a handoff ticket');
  // Write a determination in the drawer; the brief repaints without a reload.
  await page.locator('.logit').getByRole('button', { name: 'Open Casebook: Handoff' }).click();
  const cb = drawer(page);
  await expect(cb.getByRole('tab', { name: 'Handoff' })).toHaveAttribute('aria-selected', 'true');
  await cb.getByRole('tab', { name: 'Determination' }).click();
  await cb.locator('#cb-determination-verdict').selectOption('confirmed');
  await cb.locator('#cb-determination-confidence').selectOption('high');
  await cb.locator('#cb-determination-summary').fill('An outside party used the pledge-desk credential. The person is unidentified.');
  await cb.getByRole('button', { name: 'Save' }).click();
  await expect(cb.locator('.cbstatus')).toContainText('Determination saved');
  await expect(cb.locator('.cbstatus')).toContainText('needs at least one Evidence entry');   // saved, and told what is missing
  await expect(brief).toContainText('Confirmed incident · confidence high');
  await expect(brief).not.toContainText('Nothing logged for the determination yet.');
  // Assemble pulls the determination into the ticket draft; nothing is saved until Save.
  await cb.getByRole('tab', { name: 'Handoff' }).click();
  await cb.getByRole('button', { name: 'Assemble from casebook' }).click();
  await expect(cb.locator('#cb-handoff-problem')).toHaveValue('An outside party used the pledge-desk credential. The person is unidentified.');
  await expect(cb.locator('.cbstatus')).toContainText('Nothing is saved until you press Save.');
  await page.keyboard.press('Escape');
  // Case closed: the casebook section shows the determination and says the handoff is not written, with the mission that asks for it.
  await page.goto('#closed');
  const section = page.getByRole('region', { name: 'Casebook' });
  await expect(section).toContainText('Confirmed incident · confidence high');
  await expect(section).toContainText('An outside party used the pledge-desk credential.');
  await expect(section).toContainText('Handoff ticket');
  await expect(section.getByRole('link', { name: 'C06-M04' })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Download Markdown' })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Copy handoff ticket' })).toBeVisible();
});
