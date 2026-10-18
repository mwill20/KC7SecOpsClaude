// Post-build check of dist/: the release artifact must be exactly the runtime allowlist and nothing else, must keep
// the no-network CSP, must reference nothing by absolute or remote URL, and must stay fictional. It runs after every
// build (npm run build) and inside npm run verify; the Pages workflow refuses to upload a dist/ that fails it.
// Exported as a function so tests can point it at a planted copy and prove it rejects it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './lib.mjs';
import { runtimeFiles } from './files.mjs';

// Hosts the site may name: fictional .example domains and Google's own documentation, which the UI links to on click.
const DOC_HOSTS = ['docs.cloud.google.com'];
// RFC 5737 documentation ranges plus the fictional station LAN. Same rule as tests/unit/content.test.mjs C5.
const IP_OK = /^(?:10\.9\.4|192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/;
const TLD = /(?<![.\w$-])(?:[a-z0-9-]+\.)+(?:com|org|net|io|edu|gov|example)\b/g;

const walk = (dir, prefix = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  if (e.isSymbolicLink()) throw new Error('ARTIFACT_SYMLINK ' + prefix + e.name);
  return e.isDirectory() ? walk(path.join(dir, e.name), prefix + e.name + '/') : [prefix + e.name];
});

export function checkArtifact(dist = path.join(root, 'dist'), site = path.join(root, 'site')) {
  const problems = [];
  if (!fs.existsSync(dist)) return ['ARTIFACT_MISSING ' + dist];
  const found = walk(dist).sort(), expected = [...runtimeFiles].sort();
  for (const f of found) if (!expected.includes(f)) problems.push('STRAY_FILE ' + f);
  for (const f of expected) if (!found.includes(f)) problems.push('MISSING_FILE ' + f);
  for (const f of runtimeFiles) {
    if (f === 'bundle.js' || !found.includes(f)) continue;
    if (!fs.readFileSync(path.join(dist, f)).equals(fs.readFileSync(path.join(site, f)))) problems.push('SOURCE_MISMATCH ' + f);
  }
  if (found.includes('index.html')) {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1] ?? '';
    if (!/(?:^|;\s*)connect-src 'none'(?:;|$)/.test(csp)) problems.push("CSP_CONNECT_SRC index.html must carry connect-src 'none'");
    if (!/(?:^|;\s*)default-src 'none'(?:;|$)/.test(csp)) problems.push("CSP_DEFAULT_SRC index.html must carry default-src 'none'");
    for (const m of html.matchAll(/(?:src|href)=["']([^"']*)["']/g)) if (/^(?:[a-z]+:|\/)/i.test(m[1])) problems.push('ABSOLUTE_REF index.html ' + m[1]);
  }
  for (const f of found) {
    if (!/\.(?:js|html|css)$/.test(f)) { problems.push('UNEXPECTED_TYPE ' + f); continue; }
    const text = fs.readFileSync(path.join(dist, f), 'utf8');
    if (f.endsWith('.js')) {
      for (const m of text.matchAll(/\b(?:import|export)\b[^'"\n]*\bfrom\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const spec = m[1] ?? m[2];
        if (!spec.startsWith('./') && !spec.startsWith('../')) { problems.push('NON_RELATIVE_IMPORT ' + f + ' ' + spec); continue; }
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), spec));
        if (!runtimeFiles.includes(target)) problems.push('UNBUNDLED_IMPORT ' + f + ' ' + spec);
      }
      if (/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|new\s+WebSocket|EventSource\(|\beval\s*\(|new\s+Function\b|\.innerHTML\s*=/.test(text)) problems.push('FORBIDDEN_API ' + f);
    }
    for (const ip of new Set(text.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) ?? [])) if (!IP_OK.test(ip)) problems.push('REAL_IP ' + f + ' ' + ip);
    for (const d of new Set(text.toLowerCase().match(TLD) ?? [])) if (!d.endsWith('.example') && !DOC_HOSTS.includes(d)) problems.push('REAL_DOMAIN ' + f + ' ' + d);
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkArtifact();
  if (problems.length) { console.error('artifact check failed:\n  ' + problems.join('\n  ')); process.exit(1); }
  console.log('artifact check passed:', runtimeFiles.length, 'files, allowlist exact, connect-src none, fictional only');
}
