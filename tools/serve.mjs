// Local preview of dist/. Serves only the allowlisted runtime files, read-only, on loopback.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './lib.mjs';
import { runtimeFiles } from './build.mjs';

const allowed = new Set(runtimeFiles);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const port = Number(process.env.PIER9_PORT ?? 4180);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT_INVALID');
http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  const url = req.url.split('?')[0];
  if (url.includes('..') || url.includes('%') || url.includes('\\')) { res.writeHead(400); return res.end(); }
  const file = url === '/' ? 'index.html' : url.slice(1);
  if (!allowed.has(file)) { res.writeHead(404); return res.end(); }
  const full = path.join(root, 'dist', file);
  if (!fs.existsSync(full)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', types[path.extname(file)]); res.writeHead(200);
  res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(full));
}).listen(port, '127.0.0.1', () => console.log('Pier Nine preview: http://127.0.0.1:' + port));
