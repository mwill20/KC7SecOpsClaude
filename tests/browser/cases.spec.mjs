// Browser checks for the two-case model: the home-page case switcher, a chapter-7 mission running against the
// second dataset, one casebook per case in the drawer, and the second case's closed page.
import { test, expect } from '@playwright/test';

const drawer = page => page.locator('#casebook');

test('Two cases: the home page switches between case files, chapter 7 runs against the week-after data, the drawer keeps one casebook per case, and each case has its own closed page', async ({ page }) => {
  await page.goto('./');
  const tabs = page.getByRole('navigation', { name: 'Cases' }).getByRole('link');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).toHaveAttribute('aria-label', 'Case 1, Static on Pier Nine: 0 of 49 missions complete');
  await expect(tabs.nth(1)).toHaveAttribute('aria-label', 'Case 2, The week after: 0 of 33 missions complete');
  await expect(page.locator('h1')).toHaveText('Static on Pier Nine');
  await expect(page.locator('a.chapter-card')).toHaveCount(6);
  await tabs.nth(1).click();
  await expect(page).toHaveURL(/#case\/week-after$/);
  await expect(page.locator('h1')).toHaveText('The week after');
  await expect(page.locator('a.chapter-card')).toHaveCount(4);
  await expect(page.locator('a.chapter-card .num').first()).toHaveText('07');
  await expect(page.getByRole('link', { name: 'Open the case →' })).toHaveAttribute('href', '#C07-M01');
  await expect(page.locator('.people')).toContainText('Lena Ostrowski');
  // The top bar carries ten chapters; chapters 7 to 10 belong to case 2.
  await expect(page.locator('#chapterprog .chap')).toHaveCount(10);
  await page.goto('#C07');
  await expect(page.locator('.crumbs')).toContainText('Case file 2: The week after');
  await expect(page.locator('h1')).toHaveText('Baselines and first sightings');
  await expect(page.getByRole('region', { name: 'Mission map' })).toContainText('0 of 8 complete');
  // A Watch mission in chapter 7 runs against the second dataset: the dedup query returns three accounts.
  await page.goto('#C07-M02');
  await expect(page.locator('.deskbar select')).toContainText('Small hours (03:00 to 06:00)');
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(page.locator('.results .summary')).toContainText('3 events');
  await expect(page.locator('.results .summary')).toContainText('deduplicated');
  await expect(page.locator('.tablewrap tbody')).toContainText('lena.ostrowski');
  await expect(page.locator('.tablewrap tbody')).not.toContainText('evt-00');
  await page.getByLabel('How many rows does the deduplicated table have (one per account)?').fill('3');
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.locator('.part [role="status"]').first()).toHaveText('Correct.');
  await page.locator('input[type="radio"][value="A"]').check();
  await page.getByRole('button', { name: 'Check call' }).click();
  await expect(page.locator('.scorebox')).toContainText('Log it to complete');
  // Log it opens the week-after casebook: the drawer's case select says so, and the entry's record ID must be a week-after record.
  await page.locator('.logit').getByRole('button', { name: 'Open Casebook: Evidence' }).click();
  const cb = drawer(page);
  await expect(cb.getByRole('combobox', { name: 'Case' })).toHaveValue('week-after');
  await expect(cb).toContainText('The week after. Your notes, in your words.');
  await cb.locator('#cb-name').fill('Did the fix hold');
  await cb.locator('#cb-evidence-time').fill('20:03');
  await cb.getByRole('button', { name: 'Use current query' }).click();
  await cb.locator('#cb-evidence-observation').fill('lena.ostrowski succeeded at VPN-GW-01 from 198.51.100.77; hostname blank.');
  await cb.locator('#cb-evidence-records').fill('evt-20200');
  await cb.locator('#cb-evidence-confidence').selectOption('high');
  await cb.getByRole('button', { name: 'Add entry' }).click();
  await expect(cb.locator('.cbstatus')).toContainText('Evidence #1 saved and passes the structure check.');
  await page.keyboard.press('Escape');
  await page.locator('.logit').getByRole('button', { name: 'Check my Casebook' }).click();
  await expect(page.locator('.logit .feedback')).toContainText('Logged.');
  await expect(page.locator('.scorebox')).toContainText('Mission complete');
  // The first case's casebook is untouched: switch the drawer to it and see no evidence; a first-case record ID is unknown in case 2.
  await page.keyboard.press('Alt+Shift+C');
  await cb.getByRole('combobox', { name: 'Case' }).selectOption('pier-nine');
  await expect(cb.getByRole('tabpanel')).toContainText('No evidence yet.');
  await expect(cb.locator('#cb-name')).toHaveValue('');
  await cb.getByRole('combobox', { name: 'Case' }).selectOption('week-after');
  await expect(cb.locator('#cb-name')).toHaveValue('Did the fix hold');
  await cb.locator('#cb-evidence-time').fill('19:21');
  await cb.locator('#cb-evidence-observation').fill('A record from last week.');
  await cb.locator('#cb-evidence-records').fill('evt-00039');
  await cb.locator('#cb-evidence-confidence').selectOption('low');
  await cb.getByRole('button', { name: 'Use current query' }).click();
  await cb.getByRole('button', { name: 'Add entry' }).click();
  await expect(cb.locator('.cbstatus')).toContainText('Record evt-00039 is not in the dataset.');
  await page.keyboard.press('Escape');
  // The second case's closed page lists its own thirty-three missions and names its own casebook; the first case's page still lists forty-nine.
  await page.goto('#closed/week-after');
  await expect(page.locator('h1')).toHaveText('The handoff is not written yet');
  await expect(page.locator('.list li')).toHaveCount(32);
  await expect(page.locator('.skills .skill')).toHaveCount(4);
  await expect(page.locator('.closedbook .cbname-title')).toHaveText('Did the fix hold');
  await expect(page.getByRole('link', { name: 'Next open mission →' })).toHaveAttribute('href', '#C07-M01');
  await page.goto('#closed');
  await expect(page.locator('.list li')).toHaveCount(49);
  await expect(page.locator('.closedbook .cbname-title')).toHaveText('Unnamed investigation');
  // Chapter 8's lookalike mission runs the regex data-table column against case 2.
  await page.goto('#C08-M02');
  await page.locator('textarea.editor').fill('metadata.event_type = "EMAIL_TRANSACTION"\nnetwork.email.from in regex %lookalike_shapes.pattern');
  await page.getByRole('button', { name: 'Check query' }).click();
  await expect(page.locator('.desk .feedback')).toContainText('Query correct');
  await expect(page.locator('.results .summary')).toContainText('3 events');
  await expect(page.locator('#topscore')).toHaveText('110 / 6,970 pts');
});
