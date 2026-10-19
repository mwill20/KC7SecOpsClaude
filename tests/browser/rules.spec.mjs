// Browser checks for rule mode (chapter 11): the desk starts a rule mission in Rule mode with the test cases beside the
// question, runs a rule into detections, grades a Build rule by its must-fire and must-not-fire cases with the
// false-positive count in the feedback, and the Mode switch lets the same data be read in Search mode.
import { test, expect } from '@playwright/test';

test('Rule mode: a rule mission runs into detections, is graded against its two test cases, and the Mode switch compares the Search count on the same data', async ({ page }) => {
  await page.goto('#C11-M02');
  const mode = page.getByLabel('Desk mode');
  await expect(mode).toHaveValue('rule');
  await expect(page.getByLabel('Training rule')).toBeVisible();
  const cases = page.getByRole('region', { name: 'Test cases' });
  await expect(cases).toContainText('Must fire');
  await expect(cases).toContainText('pledge-desk');
  await expect(cases).toContainText('19:58 UTC');
  await expect(cases).toContainText('lena.ostrowski');
  await page.getByRole('button', { name: 'Run query' }).click();
  const summary = page.locator('.results .summary');
  await expect(summary).toContainText('2 detections');
  await expect(summary).toContainText('rule failures_in_five_minutes · MEDIUM · principal.user.userid over 5m');
  await expect(page.locator('.tablewrap thead')).toContainText('window start (UTC)');
  await expect(page.locator('.tablewrap thead')).toContainText('window end (UTC)');
  await expect(page.locator('.tablewrap tbody tr').first()).toContainText('pledge-desk');
  await expect(page.locator('.tablewrap tbody tr').first()).toContainText('03-20 19:58:10');
  await page.getByLabel('How many detections does the rule produce for the whole night?').fill('2');
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.locator('.part [role="status"]').first()).toHaveText('Correct.');

  // A Build rule: the starter's gap is named; a condition that fires on the engineer fails the must-not-fire case
  // with the false-positive count; the right condition passes and names both cases.
  await page.goto('#C11-M03');
  const editor = page.locator('textarea.editor');
  const feedback = page.locator('.desk .feedback');
  await expect(page.getByRole('button', { name: 'Check rule' })).toBeVisible();
  await page.getByRole('button', { name: 'Check rule' }).click();
  await expect(feedback).toContainText('The starter still has a ___ gap.');
  const starter = await editor.inputValue();
  await editor.fill(starter.replace('$e1 and ___', '$e1'));
  await page.getByRole('button', { name: 'Check rule' }).click();
  await expect(feedback).toContainText('The rule fires on the must-not-fire case.');
  await expect(feedback).toContainText('Must not fire: dez.okafor');
  await expect(feedback).toContainText('from keys other than the must-fire case');
  await editor.fill(starter.replace('$e1 and ___', '$e1 and $e2'));
  await page.getByRole('button', { name: 'Check rule' }).click();
  await expect(feedback).toContainText('Rule correct: it fires on lena.ostrowski around 02:14 UTC and stays quiet on dez.okafor.');
  await expect(feedback).toContainText('2 detections in all; 1 from keys other than the must-fire case.');
  await expect(page.locator('.scorebox')).toContainText('Rule 60/60');
  // A rule without a condition and a bare field are refused with the rule messages.
  await editor.fill(starter.replace('$e1 and ___', '$e1 and $e2').replace(/  condition:\n[^\n]*\n/, ''));
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(feedback).toContainText('Will not run: A rule needs a condition section.');
  await editor.fill(starter.replace('$e1 and ___', '$e1 and $e2').replace('$e2.metadata.event_type', 'metadata.event_type'));
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(feedback).toContainText('Will not run: In a rule every field is written with its event variable.');

  // Same data, two counts: the rule produces two detections; switched to Search mode, by 3m returns one row.
  await page.goto('#C11-M08');
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(summary).toContainText('2 detections');
  await mode.selectOption('search');
  await expect(page.locator('.results .empty')).toBeVisible();
  await expect(page.getByLabel('Training query')).toBeVisible();
  await editor.fill('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"\n$account = principal.user.userid\nmatch:\n  $account by 3m\noutcome:\n  $failures = count(metadata.id)\ncondition:\n  $failures >= 2');
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(summary).toContainText('1 row');
  await expect(page.locator('.tablewrap tbody')).toContainText('pledge-desk');
  // the rule text in Search mode is reported as not run here, not as a mistake
  await editor.fill('rule r {\n  meta:\n    author = "a"\n}');
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(feedback).toContainText('Not run here: This looks like a detection rule.');
  // back in Rule mode a Search query is told what a rule starts with
  await mode.selectOption('rule');
  await editor.fill('metadata.event_type = "USER_LOGIN"');
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(feedback).toContainText('Will not run: A rule starts with its name and an opening brace.');
  // Chapter 11 sits in case 2: the chapter page lists nine missions, two of them Read
  await page.goto('#C11');
  await expect(page.locator('h1')).toHaveText('From search to detection');
  await expect(page.locator('.crumbs')).toContainText('Case file 2: The week after');
  await expect(page.locator('.list li')).toHaveCount(9);
  await expect(page.locator('.list .pill.read')).toHaveCount(2);
});
