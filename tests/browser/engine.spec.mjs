// Browser checks for engine v2 on the desk: the Lists panel, a reference-list query, dedup, array and earliest/latest
// rendering, and the unsupported-zone message. Deterministic like the rest of the suite.
import { test, expect } from '@playwright/test';

const SOLO = 'C01-M05';

test('Engine v2 on the desk: the Lists panel names the bundled lists and where they live in a tenant; list, dedup, array and earliest queries run and render; a non-UTC zone is reported as not run here', async ({ page }) => {
  await page.goto(`#${SOLO}`);
  const lists = page.locator('details.lists');
  await expect(lists.locator('summary')).toHaveText(/^Lists and tables \(\d+\)$/);
  await lists.locator('summary').click();
  await expect(lists).toContainText('Detection > Lists');
  await expect(lists).toContainText('Detection > Data tables');
  await expect(lists).toContainText('July 2027');
  await expect(lists.locator('code', { hasText: '%gateway_blocks' })).toBeVisible();
  await expect(lists.locator('li', { hasText: '%gateway_blocks' })).toContainText('.range · cidr · in cidr %');
  await expect(lists.locator('li', { hasText: '%station_allowlist' })).toContainText('week-one mail log');
  await expect(lists.locator('code', { hasText: '%blocked_ranges' })).toBeVisible();
  await expect(lists.locator('li', { hasText: '%blocked_ranges' })).toContainText('cidr · in cidr %');
  await expect(lists.locator('li', { hasText: '%blocked_ranges' })).toContainText('203.0.113.0/24');
  const editor = page.locator('textarea.editor');
  const feedback = page.locator('.desk .feedback');
  const run = async q => { await editor.fill(q); await page.keyboard.press('Control+Enter'); };
  // A CIDR list query returns the beacon connections; a string list typed with the wrong keyword is named.
  await run('metadata.event_type = "NETWORK_CONNECTION"\ntarget.ip in cidr %blocked_ranges');
  await expect(feedback).toHaveClass(/info/);
  await expect(page.locator('.results .summary')).toContainText(/\d+ events/);
  await run('target.ip in %blocked_ranges');
  await expect(feedback).toHaveClass(/bad/);
  await expect(feedback).toContainText('Will not run: The keyword after in must match the list type.');
  await run('target.ip in cidr %no_such_list');
  await expect(feedback).toContainText('That reference list does not exist in this trainer.');
  // A data table column runs in the same form; an unknown column is named apart from an unknown table.
  await run('metadata.event_type = "NETWORK_CONNECTION"\ntarget.ip in cidr %gateway_blocks.range');
  await expect(feedback).toHaveClass(/info/);
  await run('target.ip in cidr %gateway_blocks.cidr');
  await expect(feedback).toContainText('The data table exists, but not that column.');
  await run('target.ip = %gateway_blocks.range');
  await expect(feedback).toContainText('Not run here: Comparing a field to a reference list or data table with = is rule syntax');
  // dedup on an event query: fewer rows, labelled.
  await run('metadata.event_type = "USER_LOGIN"\ndedup:\n  principal.user.userid');
  await expect(page.locator('.results .summary')).toContainText('deduplicated');
  const deduped = await page.locator('.tablewrap tbody tr').count();
  await run('metadata.event_type = "USER_LOGIN"');
  expect(await page.locator('.tablewrap tbody tr').count()).toBeGreaterThan(deduped);
  // array_distinct renders as a comma-joined list; earliest and latest render as clock times.
  await run('metadata.event_type = "USER_LOGIN"\nprincipal.user.userid = "pledge-desk"\nmatch:\n  principal.user.userid\noutcome:\n  $where = array_distinct(principal.ip)\n  $first = earliest(metadata.event_timestamp)\n  $last = latest(metadata.event_timestamp)');
  const row = page.locator('.tablewrap tbody tr').first();
  await expect(row.locator('td').nth(1)).toContainText('198.51.100.23');
  await expect(row.locator('td').nth(1)).toContainText(', ');
  await expect(row.locator('td').nth(2)).toHaveText(/^03-13 19:05:10 \(\d+\)$/);
  await expect(row.locator('td').nth(3)).toHaveText(/^03-1\d \d\d:\d\d:\d\d \(\d+\)$/);
  // Functions: an hour filter runs in UTC; another zone is real Google syntax reported as not run here, with the zone named.
  await run('timestamp.get_hour(metadata.event_timestamp, "UTC") = 19\nmetadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"');
  await expect(feedback).toHaveClass(/info/);
  await run('timestamp.get_hour(metadata.event_timestamp, "America/Los_Angeles") = 19');
  await expect(feedback).toHaveClass(/warn/);
  await expect(feedback).toContainText('Not run here: That time zone is valid in Google SecOps, but this trainer reads the dataset in UTC only. (America/Los_Angeles)');
  await expect(feedback).toContainText('write "UTC"');
  // The field list names the functions that run here.
  await page.locator('details.fields summary').click();
  await expect(page.locator('details.fields')).toContainText('timestamp.get_hour, timestamp.get_minute, timestamp.get_date, strings.to_lower, strings.to_upper, strings.concat');
});
