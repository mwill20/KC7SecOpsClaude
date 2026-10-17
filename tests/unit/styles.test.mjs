import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../../tools/lib.mjs';

// WCAG 2.x relative luminance and contrast ratio, computed from the tokens in site/styles.css.
const css = fs.readFileSync(path.join(root, 'site', 'styles.css'), 'utf8');
const rootBlock = css.match(/:root\s*\{([^}]*)\}/)[1];
const tokens = Object.fromEntries([...rootBlock.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map(m => [m[1], m[2].toLowerCase()]));
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = h => { const [r, g, b] = hex(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
export const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const TEXT = ['text', 'muted', 'accent', 'teal', 'ok', 'bad', 'warn', 'info'];
const SURFACES = { bg: tokens.bg, panel: tokens.panel, 'panel-2': tokens['panel-2'], header: '#0a0f1b', editor: '#0a0f1b' };

test('S1 every text token reaches WCAG AA (4.5:1) on every surface it is painted on', () => {
  for (const name of TEXT) {
    assert.ok(tokens[name], 'token --' + name);
    for (const [sname, s] of Object.entries(SURFACES)) assert.ok(contrast(tokens[name], s) >= 4.5, `--${name} on ${sname}: ${contrast(tokens[name], s).toFixed(2)}`);
  }
  assert.ok(contrast('#1a1200', tokens.accent) >= 4.5, 'primary button text');
  assert.ok(contrast('#1a0a00', tokens.bad) >= 4.5, 'on-air badge');
  assert.ok(contrast('#000000', tokens.accent) >= 4.5, 'skip link');
  assert.ok(contrast('#e8f0ff', '#0a0f1b') >= 4.5, 'editor text');
});

test('S2 form-control borders reach the 3:1 non-text minimum, and the focus ring reaches it everywhere', () => {
  for (const [sname, s] of Object.entries(SURFACES)) {
    assert.ok(contrast(tokens.control, s) >= 3, `--control on ${sname}: ${contrast(tokens.control, s).toFixed(2)}`);
    assert.ok(contrast(tokens.teal, s) >= 3, `focus ring on ${sname}`);
  }
  assert.match(css, /textarea\.editor \{[^}]*border: 1px solid var\(--control\)/);
  assert.match(css, /select, input\[type=text\] \{[^}]*border: 1px solid var\(--control\)/);
});

test('S3 should-fail: the check bites on the decorative line colour and on a near-background grey', () => {
  assert.ok(contrast(tokens.line, tokens.panel) < 3, 'line is decorative only and must not be used as a control border');
  assert.ok(contrast('#4a5a78', tokens.panel) < 3);
  assert.ok(contrast('#6b7280', tokens.bg) < 4.5);
  assert.throws(() => { for (const s of Object.values(SURFACES)) assert.ok(contrast('#6b7280', s) >= 4.5); });
});

test('S4 reduced-motion rule disables transitions, animations and smooth scrolling', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*transition: none !important;[^}]*animation: none !important;[^}]*scroll-behavior: auto !important;/);
});
