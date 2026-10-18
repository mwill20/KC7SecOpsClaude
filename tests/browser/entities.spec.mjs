// Browser checks for entity context and joins on the desk: the Entities panel, an entity-only query rendered as
// directory records, the event-to-entity join as a table, and a two-event join labelled in the results bar.
import { test, expect } from '@playwright/test';

test('Entities and joins on the desk: the Entities panel names the fields and the join form, an entity query renders directory records valid in the case window, a join renders a table and says what it joined, and the should-fail messages are plain', async ({ page }) => {
  await page.goto('#C07-M02');
  const panel = page.locator('details.entities');
  await expect(panel.locator('summary')).toHaveText(/^Entities \(\d+ users, \d+ assets\)$/);
  await panel.locator('summary').click();
  await expect(panel).toContainText('graph.entity.user.employment_status');
  await expect(panel).toContainText('$u.graph.entity.user.userid = $uid');
  await expect(panel).toContainText('Verify both in a tenant');
  const editor = page.locator('textarea.editor');
  const feedback = page.locator('.desk .feedback');
  const run = async q => { await editor.fill(q); await page.keyboard.press('Control+Enter'); };
  // The directory as it stood in the week after: marco.vela is TERMINATED, STUDIO-B belongs to kenji.mori.
  await run('graph.metadata.entity_type = "USER"\ngraph.entity.user.employment_status = "TERMINATED"');
  await expect(feedback).toHaveClass(/info/);
  await expect(page.locator('.results .summary')).toContainText('1 entity record');
  const row = page.locator('.tablewrap tbody tr').first();
  await expect(row).toContainText('marco.vela');
  await expect(row).toContainText('2026-03-16 to 2026-12-31');
  await expect(page.locator('.tablewrap thead')).toContainText('valid (UTC)');
  await row.getByRole('button', { name: /Open record ent-\d{5}/ }).click();
  await expect(page.getByRole('region', { name: 'Full record' })).toContainText('graph.metadata.interval.start_time.seconds');
  await run('graph.entity.hostname = "STUDIO-B"');
  await expect(page.locator('.tablewrap tbody tr').first()).toContainText('kenji.mori');
  // The event-to-entity join: gateway successes with the account's remote_access label beside them.
  await run('$e.metadata.event_type = "USER_LOGIN"\n$e.target.hostname = "VPN-GW-01"\n$e.security_result.action = "ALLOW"\n$e.principal.user.userid = $uid\n$u.graph.entity.user.userid = $uid\nmatch:\n  $uid\noutcome:\n  $remote = array_distinct($u.graph.entity.user.attribute.labels.remote_access)\n  $n = count($e.metadata.id)\norder:\n  $n desc');
  await expect(page.locator('.results .summary')).toContainText('3 rows');
  await expect(page.locator('.results .summary')).toContainText('joined $e and $u');
  await expect(page.locator('.tablewrap thead')).toContainText('user.userid = principal.user.userid');
  await expect(page.locator('.tablewrap tbody tr').first()).toContainText('lena.ostrowski');
  await expect(page.locator('.tablewrap tbody tr').first()).toContainText('no');
  // A two-event join with a window is labelled with the window; the documented should-fail shapes read as plain language.
  await run('$e1.metadata.event_type = "USER_LOGIN"\n$e1.target.hostname = "VPN-GW-01"\n$e1.security_result.action = "ALLOW"\n$e1.principal.user.userid = $account\n$e2.metadata.event_type = "USER_LOGIN"\n$e2.target.hostname = "FS-01"\n$e2.principal.user.userid = $account\nmatch:\n  $account over 1h\noutcome:\n  $gateway = count($e1.metadata.id)\n  $fs = count($e2.metadata.id)\ncondition:\n  #e1 > 0 and #e2 > 0');
  await expect(page.locator('.results .summary')).toContainText('joined $e1 and $e2 within 1h');
  await expect(page.locator('.tablewrap tbody')).toContainText('lena.ostrowski');
  await run('$e1.metadata.event_type = "USER_LOGIN"\n$e2.metadata.event_type = "FILE_CREATION"\nmatch:\n  $e1.principal.user.userid');
  await expect(feedback).toContainText('Will not run: Two event variables, but nothing joins them.');
  await run('$e1.metadata.event_type = "USER_LOGIN"\n$e1.principal.user.userid = $a\n$e2.metadata.event_type = "FILE_CREATION"\n$e2.principal.user.userid = $a\nmatch:\n  $a over 1h\ncondition:\n  #e2 = 0');
  await expect(feedback).toContainText('Not run here: A non-existence condition is real Google syntax this trainer does not run.');
  await run('graph.entity.user.userid = "lena.ostrowski"\nmetadata.event_type = "USER_LOGIN"');
  await expect(feedback).toContainText('Will not run: Entity fields (graph.*) and event fields cannot share one filter.');
});
