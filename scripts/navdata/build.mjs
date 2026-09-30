// Gera server/navdata.js a partir da saída bruta da extração (scripts/navdata/out/).
// Ver scripts/navdata/README.md pro fluxo completo.
//
//   node scripts/navdata/build.mjs
//
// O que este passo faz que a extração (no navegador) não faz:
//  1. Descarta tudo que a IA não alcança andando a partir do spawn — uma sala que só
//     se chega por escada, um vão entre móveis, uma ilhota. A grade entregue ao
//     servidor só tem células ALCANÇÁVEIS, então "esconderijo" nunca é um lugar pra
//     onde a IA não consiga ir.
//  2. Liga cada esconderijo a uma célula de aproximação alcançável (a IA caminha até
//     ali e dá o último passo reto até o ponto exato).
//  3. Afina: a extração devolve um ponto a cada ~0.5m de parede; a IA só precisa de
//     lugares espaçados o bastante pra serem escolhas distintas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.OUT_DIR || path.join(here, 'out');
const target = path.join(here, '..', '..', 'server', 'navdata.js');

const LAYOUTS = [1, 4, 5]; // ONLINE_LAYOUTS (src/net/protocol.js)
const APPROACH_MAX = 1.0;  // m entre o ponto do esconderijo e a célula de onde a IA parte pra ele
const WALL_SEPARATION = 1.5;
const FLOOR_SEPARATION = 1.8;
const MAX_SPOTS = 220;     // por layout

const r2 = (n) => Math.round(n * 100) / 100;
const hex = (n) => '0x' + n.toString(16).padStart(6, '0');

function build(raw) {
  const { cell, x0, z0, cols, rows } = raw;
  const free = new Uint8Array(cols * rows);
  raw.grid.forEach((line, r) => { for (let c = 0; c < cols; c++) free[r * cols + c] = line[c] === '.' ? 1 : 0; });
  const at = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && free[r * cols + c] === 1;
  const cellOf = (x, z) => [Math.floor((x - x0) / cell), Math.floor((z - z0) / cell)];
  const center = (c, r) => [x0 + (c + 0.5) * cell, z0 + (r + 0.5) * cell];

  // ---- alcançável a partir do spawn (8 vizinhos, sem cortar quina) ---------------
  const [sc, sr] = cellOf(raw.spawn.x, raw.spawn.z);
  let seed = null;
  for (let rad = 0; rad <= 8 && !seed; rad++) {
    for (let dr = -rad; dr <= rad && !seed; dr++) {
      for (let dc = -rad; dc <= rad; dc++) if (at(sc + dc, sr + dr)) { seed = [sc + dc, sr + dr]; break; }
    }
  }
  if (!seed) throw new Error(`layout ${raw.layout}: nenhuma célula livre perto do spawn`);
  const reach = new Uint8Array(cols * rows);
  const queue = [seed];
  reach[seed[1] * cols + seed[0]] = 1;
  while (queue.length) {
    const [c, r] = queue.pop();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        const nc = c + dc, nr = r + dr;
        if (!at(nc, nr) || reach[nr * cols + nc]) continue;
        if (dc && dr && (!at(c + dc, r) || !at(c, r + dr))) continue;
        reach[nr * cols + nc] = 1;
        queue.push([nc, nr]);
      }
    }
  }
  const grid = [];
  let reachable = 0;
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) { const ok = reach[r * cols + c]; line += ok ? '.' : '#'; reachable += ok; }
    grid.push(line);
  }

  // ---- célula de aproximação -----------------------------------------------------
  const approachOf = (x, z) => {
    const [c0, r0] = cellOf(x, z);
    const span = Math.ceil(APPROACH_MAX / cell) + 1;
    let best = null, bestD = Infinity;
    for (let dr = -span; dr <= span; dr++) {
      for (let dc = -span; dc <= span; dc++) {
        const c = c0 + dc, r = r0 + dr;
        if (c < 0 || r < 0 || c >= cols || r >= rows || !reach[r * cols + c]) continue;
        const [cx, cz] = center(c, r);
        const d = Math.hypot(cx - x, cz - z);
        if (d < bestD) { bestD = d; best = [c, r]; }
      }
    }
    return bestD <= APPROACH_MAX ? best : null;
  };

  // ---- esconderijos: filtra, afina, limita ------------------------------------
  const candidates = [];
  for (const s of raw.wall) {
    if (!approachOf(s.x, s.z)) continue;
    candidates.push({ kind: 'w', x: s.x, z: s.z, yaw: Math.atan2(-s.nx, -s.nz), upper: s.color, lower: s.lowerColor });
  }
  for (const s of raw.floor) {
    if (!approachOf(s.x, s.z)) continue;
    candidates.push({ kind: 'p', x: s.x, z: s.z, yaw: 0, upper: s.color, lower: s.color });
  }
  // Ordem determinística (o mesmo JSON de entrada gera sempre o mesmo arquivo).
  candidates.sort((a, b) => a.kind.localeCompare(b.kind) || a.z - b.z || a.x - b.x);
  let kept = [];
  for (const cand of candidates) {
    const sep = cand.kind === 'w' ? WALL_SEPARATION : FLOOR_SEPARATION;
    if (kept.every((k) => Math.hypot(k.x - cand.x, k.z - cand.z) >= sep)) kept.push(cand);
  }
  if (kept.length > MAX_SPOTS) {
    const stride = kept.length / MAX_SPOTS;
    kept = Array.from({ length: MAX_SPOTS }, (_, i) => kept[Math.floor(i * stride)]);
  }

  return {
    layout: raw.layout, cell, x0, z0, cols, rows, grid, reachable,
    spots: kept.map((s) => [s.kind, r2(s.x), r2(s.z), r2(s.yaw), s.upper, s.lower]),
    dropped: { wall: raw.wall.length, floor: raw.floor.length, kept: kept.length },
  };
}

const parts = [];
const report = [];
for (const layout of LAYOUTS) {
  const file = path.join(outDir, `layout-${layout}.json`);
  if (!fs.existsSync(file)) throw new Error(`falta ${file} — rode a extração deste layout (README)`);
  const built = build(JSON.parse(fs.readFileSync(file, 'utf8')));
  report.push(`layout ${layout}: grade ${built.cols}x${built.rows}, ${built.reachable} células alcançáveis, ` +
    `${built.dropped.wall} brutos de parede + ${built.dropped.floor} de chão -> ${built.dropped.kept} esconderijos`);
  parts.push(
    `  ${layout}: {\n` +
    `    cell: ${built.cell}, x0: ${built.x0}, z0: ${built.z0}, cols: ${built.cols}, rows: ${built.rows},\n` +
    `    grid: [\n${built.grid.map((l) => `      '${l}',`).join('\n')}\n    ],\n` +
    `    spots: [\n${built.spots.map((s) => `      ['${s[0]}', ${s[1]}, ${s[2]}, ${s[3]}, ${hex(s[4])}, ${hex(s[5])}],`).join('\n')}\n    ],\n` +
    `  },`
  );
}

const source = `// GERADO por scripts/navdata/build.mjs a partir de uma extração do jogo real
// (scripts/navdata/extract.browser.mjs) — NÃO edite à mão. Dados de navegação e de
// esconderijos da IA do servidor (server/botAI.js), só do TÉRREO de cada layout.
//
// Por que um arquivo gerado: o servidor nunca roda Level.js (depende de canvas/DOM),
// então a geometria chega como snapshot — mesma fragilidade de src/net/occluders.js:
// se o mapa mudar em Level.js, este arquivo fica desatualizado EM SILÊNCIO. Quem mexer
// na planta de um layout (parede, móvel, escada, cor de superfície) deve regerar —
// passo a passo em scripts/navdata/README.md.
//
// Formato de cada layout:
//   cell, x0, z0, cols, rows  grade de células de \`cell\` metros; célula (c, r) tem o
//                             centro em (x0 + (c+.5)*cell, z0 + (r+.5)*cell).
//   grid                      uma string por linha (z crescente): '.' = a IA pode pisar
//                             (já descontado o raio dela, e só o que é alcançável a
//                             partir do spawn), '#' = bloqueado (parede, móvel, escada,
//                             buraco de escada, ilhota inalcançável).
//   spots                     esconderijos: [tipo, x, z, yaw, corSuperior, corInferior]
//                             tipo 'w' = grudado na parede (yaw = virado pra ela, cores
//                             = o que o jogo mede atrás de cada zona do corpo);
//                             tipo 'p' = deitado num tapete colorável.
export const NAVDATA_BY_LAYOUT = {
${parts.join('\n')}
};
`;
fs.writeFileSync(target, source);
console.log(report.join('\n'));
console.log(`escreveu ${target} (${(source.length / 1024).toFixed(0)} KB)`);
