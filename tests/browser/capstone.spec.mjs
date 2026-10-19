// Browser checks for the third case: the case switcher reaches it, a capstone mission shows the question and the Log it
// without explained query parts, the rule mission in chapter 12 carries its test cases, the Entities panel shows the
// co-operative's directory, and the case-closed page carries the engineering bridge once every mission is complete.
import { test, expect } from '@playwright/test';

async function seedProgress(page, ids) {
  await page.addInitScript(({ ids }) => {
    const missions = {};
    for (const [id, kind, logIt] of ids) missions[id] = { q: kind === 'build' || kind === 'solo' ? 60 : 0, a: kind === 'read' ? 0 : 25, c: 15, cb: logIt ? 10 : 0, h: 0 };
    localStorage.setItem('pier9.progress.v1', JSON.stringify({ v: 1, missions }));
  }, { ids });
}

test('The third case: its own case file, directory and desk; a capstone mission with no explain blocks; the bridge on its closed page once complete', async ({ page, browser }) => {
  await page.goto('#case/saltmarsh');
  await expect(page.locator('h1')).toHaveText('A different pier');
  await expect(page.locator('.eyebrow').first()).toContainText('Case file 3 of 3');
  await expect(page.locator('a.chapter-card')).toHaveCount(1);
  await expect(page.locator('a.chapter-card .num')).toHaveText('12');
  await expect(page.locator('.people')).toContainText('Rafael Quinn');
  await expect(page.locator('.people')).not.toContainText('Odalys');
  await expect(page.getByLabel('Time range', { exact: true })).toHaveCount(0);
  // The first capstone mission: question, hints and Log it, no "Read the query" card, the co-operative's directory.
  await page.goto('#C12-M01');
  await expect(page.locator('.crumbs')).toContainText('Case file 3');
  await expect(page.getByText('Read the query')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show a hint' })).toBeVisible();
  await expect(page.getByLabel('Time range')).toContainText('Whole day (06:00 to 16:00)');
  const panel = page.locator('details.entities');
  await expect(panel.locator('summary')).toHaveText('Entities (9 users, 8 assets)');
  const editor = page.locator('textarea.editor');
  await editor.fill('graph.metadata.entity_type = "ASSET"\ngraph.entity.asset.attribute.labels.criticality = "HIGH"');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.results .summary')).toContainText('3 entity records');
  await expect(page.locator('.tablewrap tbody')).toContainText('DISPATCH-01');
  await expect(page.locator('.tablewrap tbody')).not.toContainText('FS-01');
  await editor.fill('metadata.event_type = "PROCESS_LAUNCH"\ntarget.process.command_line = /TideWatch-4\\.7\\.2\\.msi/');
  await page.getByRole('button', { name: 'Check query' }).click();
  await expect(page.locator('.desk .feedback')).toContainText('Query correct');
  await expect(page.locator('.results .summary')).toContainText('3 events');
  await expect(page.locator('.tablewrap tbody').getByRole('button', { name: 'Open record evt-30157' })).toBeVisible();
  // The Log it asks for the Scope and opens this case's casebook.
  await expect(page.locator('.logit')).toContainText('This mission earned: a scope');
  await page.locator('.logit').getByRole('button', { name: 'Open Casebook: Scope' }).click();
  await expect(page.locator('#casebook').getByRole('combobox', { name: 'Case' })).toHaveValue('saltmarsh');
  await page.keyboard.press('Escape');
  // The rule mission in the capstone carries its two cases and starts in Rule mode.
  await page.goto('#C12-M08');
  await expect(page.getByLabel('Desk mode')).toHaveValue('rule');
  await expect(page.getByRole('region', { name: 'Test cases' })).toContainText('DISPATCH-01');
  await expect(page.getByRole('region', { name: 'Test cases' })).toContainText('OFFICE-02');
  // Case closed, open state: no bridge yet. Seeded complete: the bridge with its four items and the next-case link absent.
  await page.goto('#closed/saltmarsh');
  await expect(page.locator('h1')).toHaveText('The handoff is not written yet');
  await expect(page.locator('.list li')).toHaveCount(10);
  await expect(page.getByRole('region', { name: 'Cybersecurity Engineering bridge' })).toHaveCount(0);
  const ctx = await browser.newContext(); const done = await ctx.newPage();
  const ids = await (async () => { const p = await ctx.newPage(); await p.goto('./'); const r = await p.evaluate(async () => { const { CONTENT } = await import('./bundle.js'); return CONTENT.chapters.flatMap(c => c.missions.map(m => [m.id, m.kind, Boolean(m.logIt)])); }); await p.close(); return r; })();
  await seedProgress(done, ids);
  await done.goto('#closed/saltmarsh');
  await expect(done.locator('h1')).toHaveText('The handoff');
  const bridge = done.getByRole('region', { name: 'Cybersecurity Engineering bridge' });
  await expect(bridge).toBeVisible();
  await expect(bridge.locator('.skill')).toHaveCount(4);
  await expect(bridge).toContainText('Acceptance tests');
  await expect(bridge).toContainText('must fire DISPATCH-01 at 09:32');
  await expect(done.getByRole('region', { name: 'Facts' })).toContainText('evt-30475');
  await expect(done.getByRole('link', { name: /Next case/ })).toHaveCount(0);
  // The first two cases' closed pages carry no bridge.
  await done.goto('#closed');
  await expect(done.getByRole('region', { name: 'Cybersecurity Engineering bridge' })).toHaveCount(0);
  await ctx.close();
});
