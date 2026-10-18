import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { root } from '../../tools/lib.mjs';
import { runtimeFiles } from '../../tools/files.mjs';
import { checkArtifact } from '../../tools/check-artifact.mjs';
import '../../tools/build.mjs'; // builds a fresh dist/ so this file is self-contained

// Each should-fail test works on a throwaway copy of the freshly built dist/ so planting files never touches the real artifact.
const dist = path.join(root, 'dist');
const copy = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pier9-dist-')); fs.cpSync(dist, d, { recursive: true }); return d; };
const codes = p => p.map(x => x.split(' ')[0]);

test('A1 the real build passes: exactly the allowlist, connect-src none, fictional identifiers only', () => {
  assert.deepEqual(checkArtifact(dist), []);
  assert.deepEqual(checkArtifact(copy()), []);
});

test('A2 should-fail: a stray file anywhere in the artifact is rejected, including a dotfile and a nested one', () => {
  const d = copy();
  fs.writeFileSync(path.join(d, 'events.json'), '{}');
  fs.mkdirSync(path.join(d, 'tests')); fs.writeFileSync(path.join(d, 'tests', 'secret.test.mjs'), '');
  fs.writeFileSync(path.join(d, '.env'), 'TOKEN=x');
  const p = checkArtifact(d);
  assert.ok(p.includes('STRAY_FILE events.json'), p.join());
  assert.ok(p.includes('STRAY_FILE tests/secret.test.mjs'));
  assert.ok(p.includes('STRAY_FILE .env'));
});

test('A3 should-fail: a missing runtime file, a modified copy and a symlink are each rejected', () => {
  const d = copy();
  fs.rmSync(path.join(d, 'ui', 'render.js'));
  fs.appendFileSync(path.join(d, 'engine', 'grader.js'), '\n// tampered\n');
  const p = checkArtifact(d);
  assert.ok(p.includes('MISSING_FILE ui/render.js'));
  assert.ok(p.includes('SOURCE_MISMATCH engine/grader.js'));
  const s = copy();
  try { fs.symlinkSync(path.join(root, 'package.json'), path.join(s, 'package.json')); }
  catch (e) { if (e.code === 'EPERM') return; throw e; } // Windows without developer mode cannot create symlinks; the other checks still ran
  assert.throws(() => checkArtifact(s), /ARTIFACT_SYMLINK/);
});

test('A4 should-fail: index.html without connect-src none, or with an absolute or remote reference, is rejected', () => {
  const d = copy();
  const html = fs.readFileSync(path.join(d, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(d, 'index.html'), html.replace("connect-src 'none'", "connect-src https://telemetry.example"));
  assert.ok(codes(checkArtifact(d)).includes('CSP_CONNECT_SRC'));
  const e = copy();
  fs.writeFileSync(path.join(e, 'index.html'), html.replace('href="styles.css"', 'href="/styles.css"').replace('src="app.js"', 'src="https://cdn.example/app.js"'));
  const p = checkArtifact(e);
  assert.ok(p.includes('ABSOLUTE_REF index.html /styles.css'), p.join());
  assert.ok(p.includes('ABSOLUTE_REF index.html https://cdn.example/app.js'));
});

test('A5 should-fail: a real-looking IP, a non-.example domain, a non-relative import and a network API are each rejected', () => {
  const d = copy();
  fs.appendFileSync(path.join(d, 'bundle.js'), '\n// 8.8.8.8 and login.contoso-corp.com slipped in\n');
  fs.appendFileSync(path.join(d, 'app.js'), "\nimport x from 'https://cdn.example/x.js';\nimport y from './missing.js';\nfetch('https://a.example');\n");
  const p = checkArtifact(d);
  assert.ok(p.includes('REAL_IP bundle.js 8.8.8.8'), p.join());
  assert.ok(p.includes('REAL_DOMAIN bundle.js login.contoso-corp.com'));
  assert.ok(p.includes('NON_RELATIVE_IMPORT app.js https://cdn.example/x.js'));
  assert.ok(p.includes('UNBUNDLED_IMPORT app.js ./missing.js'));
  assert.ok(p.includes('FORBIDDEN_API app.js'));
  assert.ok(p.includes('SOURCE_MISMATCH app.js'));
  // the allowed documentation host and the fictional ranges are not flagged
  assert.ok(!checkArtifact(dist).some(x => x.includes('docs.cloud.google.com') || x.includes('203.0.113')));
});

test('A6 the allowlist is the single source of truth: every entry exists in site/ except the generated bundle', () => {
  for (const f of runtimeFiles) if (f !== 'bundle.js') assert.ok(fs.existsSync(path.join(root, 'site', f)), f);
  assert.equal(runtimeFiles.length, 14);
});
