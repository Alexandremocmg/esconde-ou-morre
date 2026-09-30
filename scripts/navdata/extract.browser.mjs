// Extrai, do jogo REAL rodando no navegador, os dados de navegação e de esconderijos
// que a IA do servidor usa (server/navdata.js). Ferramenta de desenvolvimento — não é
// carregada pelo jogo. Uso e fluxo completo: scripts/navdata/README.md.
//
// Por que aqui dentro do navegador e não num harness Node com mocks de Three.js: o
// servidor nunca roda Level.js (depende de canvas/DOM), então a única fonte de verdade
// da geometria é o cliente de verdade — mesma razão do snapshot de oclusores
// (src/net/occluders.js). E, pra esconderijo, dá pra fazer melhor que copiar
// geometria: este script usa o PRÓPRIO `Player` (toggleLatch, _surfaceBehindZone,
// _surfaceBelowColor) pra descobrir onde dá pra grudar e que cor o jogo de fato
// mede ali. Um esconderijo extraído assim é, por construção, um lugar onde um humano
// consegue se esconder com as mesmas regras — a IA não ganha nem perde nada que o
// Camaleão humano não tenha.
//
// Rodar uma vez por layout (`?stage=1|4|5`, modo solo Camaleão) — ver README.

import * as THREE from 'three';
import { GROUND_Y } from '/src/net/protocol.js';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

// Raio da IA pra colisão com a geometria (o Player tem RADIUS=0.36; folga de 4 cm).
const BOT_RADIUS = 0.4;
// Faixa de altura em que um sólido bloqueia quem anda no térreo: abaixo de STEP_UP
// (0.30, Player.js) o jogador sobe andando; acima da altura do corpo não atrapalha.
const BLOCK_MIN_Y = 0.35;
const BLOCK_MAX_Y = 1.5;
// Piso do térreo: o primeiro plano andável abaixo de 1.8m tem que estar aqui. Buraco
// de escada (porão) devolve y=-3; degrau de escada devolve y>0.35 — ambos bloqueiam.
const GROUND_MIN_Y = -0.12;
const GROUND_MAX_Y = 0.35;
const RAY_FROM_Y = 1.8;
// Só vale testar grudar em célula com algum sólido a até isto (alcance do botão
// Grudar = RADIUS + 0.7 = 1.06m, Player.js).
const LATCH_SEARCH = 1.15;
const LATCH_DIRECTIONS = 16;

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

function distXZToBox(x, z, b) {
  const dx = Math.max(b.min.x - x, 0, x - b.max.x);
  const dz = Math.max(b.min.z - z, 0, z - b.max.z);
  return Math.hypot(dx, dz);
}

export async function extract(game, { cell = 0.5, onProgress = () => {} } = {}) {
  const level = game.level;
  const player = game.player;
  // Congela o loop do jogo (Seekers/jogador) — este script move o `player` de propósito
  // e não pode disputar a posição dele com `_tick`.
  game.over = true;

  // ---- limites do mapa: união dos sólidos -------------------------------------
  const all = new THREE.Box3();
  for (const b of level.solids) all.union(b);
  const x0 = Math.floor(all.min.x / cell) * cell;
  const z0 = Math.floor(all.min.z / cell) * cell;
  const cols = Math.ceil((all.max.x - x0) / cell);
  const rows = Math.ceil((all.max.z - z0) / cell);

  // Sólidos que barram quem anda no térreo.
  const blockers = level.solids.filter((b) => b.max.y > BLOCK_MIN_Y && b.min.y < BLOCK_MAX_Y);

  const ray = new THREE.Raycaster();
  ray.far = 6;
  const cx = (c) => x0 + (c + 0.5) * cell;
  const cz = (r) => z0 + (r + 0.5) * cell;

  // ---- grade de navegação --------------------------------------------------------
  const free = new Uint8Array(cols * rows);
  let processed = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = cx(c), z = cz(r);
      let blocked = false;
      for (const b of blockers) {
        if (x > b.min.x - BOT_RADIUS && x < b.max.x + BOT_RADIUS &&
            z > b.min.z - BOT_RADIUS && z < b.max.z + BOT_RADIUS) { blocked = true; break; }
      }
      if (!blocked) {
        ray.set(new THREE.Vector3(x, RAY_FROM_Y, z), DOWN);
        const hit = ray.intersectObjects(level.walkables, false)[0];
        if (!hit || hit.point.y < GROUND_MIN_Y || hit.point.y > GROUND_MAX_Y) blocked = true;
      }
      free[r * cols + c] = blocked ? 0 : 1;
    }
    if (++processed % 8 === 0) { onProgress(`grade ${r + 1}/${rows}`); await yieldToBrowser(); }
  }
  const grid = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) line += free[r * cols + c] ? '.' : '#';
    grid.push(line);
  }

  // ---- esconderijos de parede: o botão Grudar de verdade, em todas as direções ----
  const wall = [];
  const seen = new Set();
  let tested = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!free[r * cols + c]) continue;
      const x = cx(c), z = cz(r);
      if (!blockers.some((b) => distXZToBox(x, z, b) <= LATCH_SEARCH)) continue;
      for (let k = 0; k < LATCH_DIRECTIONS; k++) {
        const yaw = (k / LATCH_DIRECTIONS) * Math.PI * 2;
        player.state = 'grounded';
        player.latchedObject = null;
        player.position.set(x, GROUND_Y, z);
        player.object.quaternion.setFromAxisAngle(UP, yaw);
        player.toggleLatch(game.camera);
        if (player.state !== 'latched') continue;

        const n = player.wallNormal;
        const p = player.position;
        const latchedMesh = player.latchedObject;
        // Só parede vertical (mesa/degrau têm normal pra cima; o jogo até deixaria, mas
        // deitar sobre uma mesa não é esconderijo que o Caçador espere olhar).
        if (Math.abs(n.y) < 0.25) {
          // O ponto grudado não pode estar dentro de OUTRO sólido (canto entre paredes).
          const inside = blockers.some((b) =>
            b !== null && p.x > b.min.x - 0.3 && p.x < b.max.x + 0.3 && p.z > b.min.z - 0.3 && p.z < b.max.z + 0.3);
          if (!inside) {
            const upper = player._surfaceBehindZone(player.zones[0]);
            const lower = player._surfaceBehindZone(player.zones[1]);
            if (upper && lower) {
              const key = `${Math.round(p.x * 4)},${Math.round(p.z * 4)},${Math.round(n.x)},${Math.round(n.z)}`;
              if (!seen.has(key)) {
                seen.add(key);
                const len = Math.hypot(n.x, n.z) || 1;
                wall.push({
                  k: 'w', x: p.x, z: p.z, nx: n.x / len, nz: n.z / len,
                  color: upper.getHex(), lowerColor: lower.getHex(),
                  surface: latchedMesh && latchedMesh.geometry ? latchedMesh.geometry.type : null,
                });
              }
            }
          }
        }
        player.state = 'grounded';
        player.latchedObject = null;
      }
      if (++tested % 120 === 0) { onProgress(`grudar ${tested} células, ${wall.length} pontos`); await yieldToBrowser(); }
    }
  }

  // ---- esconderijos no chão: tapete colorável embaixo (pose deitada) ---------------
  const floor = [];
  let fTested = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!free[r * cols + c] || (r + c) % 2) continue;
      const x = cx(c), z = cz(r);
      ray.set(new THREE.Vector3(x, GROUND_Y, z), DOWN);
      ray.far = 1.5;
      const hit = ray.intersectObjects(level.colorables, false)[0];
      ray.far = 6;
      // Só superfície rente ao piso, e que NÃO seja de pixel exato (a cor dela muda
      // dentro do mesmo objeto — uma IA que copia uma média não se camufla ali).
      if (!hit || hit.point.y > 0.12 || !hit.object.material || hit.object.userData.pixelColorable) continue;
      floor.push({ k: 'p', x, z, color: hit.object.material.color.getHex() });
      if (++fTested % 400 === 0) await yieldToBrowser();
    }
  }

  const s = level.spawn;
  return {
    layout: level.layout, cell, x0, z0, cols, rows, grid,
    wall, floor, spawn: { x: s.x, z: s.z },
    stats: { blockers: blockers.length, freeCells: free.reduce((a, v) => a + v, 0), wall: wall.length, floor: floor.length },
  };
}

// Envia o resultado pro coletor local (scripts/navdata/collect.mjs). Em vez de devolver
// o JSON pelo console: a grade do layout 5 passa de 38 mil caracteres.
export async function extractAndSend(game, collectorUrl = 'http://localhost:8790', options = {}) {
  window.__navdataStatus = 'rodando';
  try {
    const data = await extract(game, { ...options, onProgress: (m) => { window.__navdataStatus = m; } });
    const res = await fetch(`${collectorUrl}/save?layout=${data.layout}`, { method: 'POST', body: JSON.stringify(data) });
    window.__navdataStatus = res.ok ? `ok layout ${data.layout} ${JSON.stringify(data.stats)}` : `erro HTTP ${res.status}`;
  } catch (err) {
    window.__navdataStatus = `erro: ${err.message}`;
    throw err;
  }
}
