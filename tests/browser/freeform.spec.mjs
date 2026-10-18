// Browser checks for the investigation name and the FreeForm page: typing over the faded template, Insert template at
// the cursor, text-only paste, the 24 KB meter, the structure check, the export contents and file name, and 320 px.
import { test, expect } from '@playwright/test';

const KEY = 'pier9.casebook.v1';
const drawer = page => page.locator('#casebook');
const TEMPLATE_FIRST = 'ALERT / CASE #:';
const readDownload = async download => new Promise(async (resolve, reject) => { const chunks = []; const s = await download.createReadStream(); s.on('data', c => chunks.push(c)); s.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); s.on('error', reject); });

test('FreeForm: the template is a placeholder that disappears as you type, Insert template drops it in at the cursor as text, and the tab sits between Scope and Evidence', async ({ page }) => {
  await page.goto('#C01-M05');
  await page.keyboard.press('Alt+Shift+C');
  const cb = drawer(page);
  const tabs = cb.getByRole('tab');
  await expect(tabs).toHaveCount(10);
  await expect(tabs.nth(0)).toHaveText(/Scope/); await expect(tabs.nth(1)).toHaveText(/FreeForm/); await expect(tabs.nth(2)).toHaveText(/Evidence/);
  await cb.getByRole('tab', { name: 'FreeForm' }).click();
  const area = cb.locator('#cb-freeform');
  await expect(area).toHaveAttribute('placeholder', new RegExp('^' + TEMPLATE_FIRST.replace(/[/#]/g, '\\$&') + '\\nDATE-TIME \\(UTC\\):\\nQUERY:'));
  await expect(area).toHaveValue('');
  await expect(cb.getByRole('tabpanel')).toContainText('Ungraded by design');
  await expect(cb.getByRole('tabpanel')).toContainText('Not checked by Log it');
  // Typing replaces the faded template (a placeholder is not text): the value is only what was typed.
  await area.focus();
  await page.keyboard.type('hunch: the burst at 19:05 is one address');
  await expect(area).toHaveValue('hunch: the burst at 19:05 is one address');
  await expect(cb.getByRole('tab', { name: /FreeForm/ })).toHaveAttribute('aria-label', 'FreeForm, 1 entry');
  // Insert template at the cursor: the typed line stays, the template follows it as editable text.
  await cb.getByRole('button', { name: 'Insert template' }).click();
  const value = await area.inputValue();
  expect(value.startsWith('hunch: the burst at 19:05 is one address\n' + TEMPLATE_FIRST + '\n')).toBe(true);
  expect(value).toContain('\nOPEN QUESTIONS:\n');
  await expect(area).toBeFocused();
  await expect(cb.locator('.cbstatus')).toContainText('Template inserted at the cursor');
  // It is editable text now: the template line can be completed.
  await area.evaluate(n => { const at = n.value.indexOf('QUERY:') + 'QUERY:'.length; n.setSelectionRange(at, at); });
  await page.keyboard.type(' metadata.event_type = "USER_LOGIN"');
  await expect(area).toHaveValue(/QUERY: metadata\.event_type = "USER_LOGIN"\nRESULTS:/);
  // The page survives a tab change and the drawer closing and reopening.
  await cb.getByRole('tab', { name: 'Evidence' }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+Shift+C');
  await cb.getByRole('tab', { name: /FreeForm/ }).click();
  await expect(cb.locator('#cb-freeform')).toHaveValue(/^hunch: the burst at 19:05 is one address\nALERT/);
});

test('FreeForm: paste arrives as plain text, Windows line endings and control characters are normalised, the meter counts bytes and the 24 KB bound refuses the write', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Open the Casebook' }).click();
  const cb = drawer(page);
  await cb.getByRole('tab', { name: 'FreeForm' }).click();
  const area = cb.locator('#cb-freeform');
  await area.focus();
  // A paste event carrying HTML and text: only the text/plain part lands, with CRLF and a control character stripped.
  await area.evaluate(n => { const dt = new DataTransfer(); dt.setData('text/html', '<b>bold</b><img src=x onerror=alert(1)>'); dt.setData('text/plain', 'QUERY: a = "b"\r\nRESULTS: 7 rows\u0007 evt-00039'); n.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  await expect(area).toHaveValue('QUERY: a = "b"\nRESULTS: 7 rows evt-00039');
  expect(await cb.locator('.freeformpanel').evaluate(n => n.querySelectorAll('b, img').length)).toBe(0);
  await expect(cb.getByRole('img', { name: /^FreeForm: 40 B of 24\.0 KB used$/ })).toBeVisible();
  // The structure check reports presence only.
  await cb.getByRole('button', { name: 'Check structure' }).click();
  await expect(cb.locator('.cbstatus')).toHaveText('Structure only, nothing graded. UTC time (HH:MM): none. a query line: found. record IDs: evt-00039.');
  await area.focus();
  await area.evaluate(n => { n.setSelectionRange(0, 0); });
  await page.keyboard.type('DATE-TIME (UTC): 19:05 evt-99999 ');
  await cb.getByRole('button', { name: 'Check structure' }).click();
  await expect(cb.locator('.cbstatus')).toHaveText('Structure only, nothing graded. UTC time (HH:MM): found. a query line: found. record IDs: evt-00039 (not in this dataset: evt-99999).');
  await expect(cb.locator('.cbstatus')).toHaveClass(/ok/);
  // Over the bound: the write is refused and the page keeps what it had.
  const before = await area.inputValue();
  await area.evaluate(n => { const dt = new DataTransfer(); dt.setData('text/plain', 'x'.repeat(24576)); n.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  await expect(cb.locator('.cbstatus')).toContainText('The FreeForm page is full (24 KB)');
  await expect(area).toHaveValue(before);
  // Nothing reached storage with remembering off.
  expect(await page.evaluate(k => localStorage.getItem(k), KEY)).toBeNull();
});

test('Name and export: the investigation name is the first field, appears in the header, the Markdown title and file name, the case-closed page, and the export carries the Free-form notes; the Scope check asks for the name', async ({ page }) => {
  await page.goto('#C01-M01');
  await page.keyboard.press('Alt+Shift+C');
  const cb = drawer(page);
  const name = cb.locator('#cb-name');
  await expect(name).toHaveAttribute('placeholder', 'Name this investigation');
  // Focus order: the title, Close, the name field, then the tabs.
  expect(await cb.evaluate(root => [...root.querySelectorAll('input, button, select, textarea, [role=tab]')].findIndex(n => n.id === 'cb-name'))).toBeLessThan(3);
  await cb.getByRole('tab', { name: 'Scope' }).click();
  await cb.locator('#cb-scope-question').fill('Everyone who touched a keyboard tonight.');
  await cb.locator('#cb-scope-requestedBy').fill('Odalys Reyes');
  await cb.locator('#cb-scope-window').fill('18:00 to 06:00');
  await cb.locator('#cb-scope-inScope').fill('Login, email, process and network activity.');
  await cb.locator('#cb-scope-outScope').fill('Naming a person.');
  await cb.getByRole('button', { name: 'Save' }).click();
  await expect(cb.locator('.cbstatus')).toContainText('Name the investigation in the field at the top of the Casebook.');
  await name.fill('Pledge Night: static at 03:10');
  await cb.getByRole('button', { name: 'Save' }).click();
  await expect(cb.locator('.cbstatus')).toContainText('Scope saved and passes the structure check.');
  await cb.getByRole('tab', { name: 'FreeForm' }).click();
  await cb.locator('#cb-freeform').fill('OBSERVATION: seven failures 19:05 to 19:10\nQUERY: principal.user.userid = "pledge-desk"');
  const [download] = await Promise.all([page.waitForEvent('download'), cb.getByRole('button', { name: 'Download Markdown' }).click()]);
  expect(download.suggestedFilename()).toBe('casebook-pledge-night-static-at-03-10.md');
  const text = await readDownload(download);
  expect(text).toMatch(/^# Casebook: Pledge Night: static at 03:10 \(Static on Pier Nine\)/);
  expect(text).toContain('## Scope\n\n- Investigation: Pledge Night: static at 03:10\n- Question asked: Everyone who touched a keyboard tonight.');
  expect(text).toContain('## Free-form notes\n\n```text\nOBSERVATION: seven failures 19:05 to 19:10\nQUERY: principal.user.userid = "pledge-desk"\n```');
  await expect(cb.locator('.cbstatus')).toContainText('Downloaded casebook-pledge-night-static-at-03-10.md');
  // The case-closed page shows the name above the determination.
  await page.goto('#closed');
  await expect(page.locator('.closedbook .cbname-title')).toHaveText('Pledge Night: static at 03:10');
  // With no name the file falls back to the case id and the page says so.
  await page.locator('.closedbook').getByRole('button', { name: 'Open the Casebook' }).click();
  await cb.locator('#cb-name').fill('');
  await expect(page.locator('.closedbook .cbname-title')).toHaveText('Unnamed investigation');
  const [d2] = await Promise.all([page.waitForEvent('download'), cb.getByRole('button', { name: 'Download Markdown' }).click()]);
  expect(d2.suggestedFilename()).toBe('casebook-pier-nine.md');
});

test('320 px: the FreeForm page and the name field fit the sheet with no horizontal overflow, with and without a long pasted line', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const page = await context.newPage();
  const overflow = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  await page.goto('#C01-M05');
  await page.locator('#casebook-toggle').click();
  const cb = drawer(page);
  await cb.getByRole('tab', { name: 'FreeForm' }).click();
  expect(await overflow()).toBeLessThanOrEqual(0);
  const area = cb.locator('#cb-freeform');
  expect((await area.boundingBox()).width).toBeLessThanOrEqual(320);
  await cb.getByRole('button', { name: 'Insert template' }).click();
  await area.evaluate(n => { const dt = new DataTransfer(); dt.setData('text/plain', 'RESULTS: ' + 'evt-00039,'.repeat(40)); n.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  expect(await overflow(), 'after a long line').toBeLessThanOrEqual(0);
  expect(await cb.evaluate(n => n.scrollWidth - n.clientWidth)).toBeLessThanOrEqual(0);
  await cb.locator('#cb-name').fill('A very long investigation name that keeps going past the width of a phone screen');
  expect(await overflow(), 'long name').toBeLessThanOrEqual(0);
  expect(await cb.textContent()).not.toMatch(/\bnull\b|\bundefined\b/);
  await context.close();
});
