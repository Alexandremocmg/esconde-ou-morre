// Coletor local da extração de navegação (ver scripts/navdata/README.md). Recebe o JSON
// que extract.browser.mjs posta do navegador e grava em `out/layout-N.json`.
//
//   node scripts/navdata/collect.mjs [porta=8790]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.OUT_DIR || path.join(here, 'out');
const port = parseInt(process.argv[2] || '8790', 10);
fs.mkdirSync(outDir, { recursive: true });

http.createServer((req, res) => {
  // Página em localhost:8000 → coletor em localhost:8790: origem diferente.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'POST' || url.pathname !== '/save') { res.writeHead(404).end(); return; }
  const layout = parseInt(url.searchParams.get('layout'), 10);
  if (!Number.isInteger(layout) || layout < 1 || layout > 9) { res.writeHead(400).end('layout inválido'); return; }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      const body = Buffer.concat(chunks).toString('utf8');
      JSON.parse(body); // recusa lixo antes de gravar
      const file = path.join(outDir, `layout-${layout}.json`);
      fs.writeFileSync(file, body);
      console.log(`[coletor] layout ${layout}: ${(body.length / 1024).toFixed(0)} KB -> ${file}`);
      res.writeHead(200).end('ok');
    } catch (err) {
      console.error('[coletor] payload inválido:', err.message);
      res.writeHead(400).end('json inválido');
    }
  });
}).listen(port, () => console.log(`[coletor] http://localhost:${port}/save?layout=N -> ${outDir}`));
