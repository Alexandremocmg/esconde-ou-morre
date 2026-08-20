// Checagem de parede pro hitreg do modo Online — COMPARTILHADO entre cliente e
// servidor. Mesma regra de ouro de protocol.js/hittest.js ao lado: **nenhum import**
// (nem `three`, nem DOM) — é o que permite ao servidor Node (sem renderer nenhum)
// rodar exatamente o mesmo teste geométrico que o cliente.
//
// Lacuna real que isto fecha: hittest.js já foi desenhado esperando isto (ver o
// comentário lá: "o CLIENTE ainda precisa descartar alvos atrás de parede... O
// SERVIDOR, na v1, usa direto o primeiro" — coneCandidates devolve uma LISTA ordenada
// por ângulo de propósito, pra quem consome percorrer e ficar com o primeiro visível).
// O modo solo já faz esse raycast contra level.climbables (Game.js); o Online nunca
// fez — o servidor não tinha NENHUMA noção de geometria da mansão. Sem isto, um
// Caçador podia acertar um Camaleão atrás de uma parede só por estar dentro do
// cone/alcance, o que lia como "acertei sem nem estar mirando nele".

// Mesma referência de "sobe pro tronco" de hittest.js:AIM_UP_Y — não pode importar de
// lá (regra de zero imports vale pros dois arquivos), duplicado de propósito. Se um dia
// mudar, mudar nos dois.
const AIM_UP_Y = 0.3;

// Margem antes do alvo: não conta uma caixa bem onde o próprio alvo está (ex.: alguém
// encostado numa parede) como bloqueio do tiro que está mirando NELE.
const TARGET_MARGIN = 0.2;

// Snapshot ESTÁTICO dos AABBs de `level.climbables` do layout 1 (FIXED_LAYOUT — o
// único usado no modo Online). Extraído uma vez rodando o cliente de verdade
// (headless, Playwright) e despejando `new THREE.Box3().setFromObject(mesh)` de cada
// climbable. NÃO é gerado em runtime — o servidor Node não roda Level.js (depende de
// canvas/DOM pra materiais/texturas, ver docs/PIPELINE_PERSONAGEM.md).
//
// Fragilidade registrada: se a geometria do layout 1 em Level.js mudar (mover uma
// parede, redimensionar um pilar), este snapshot fica desatualizado EM SILÊNCIO — não
// existe checagem automática que avise. Pra regerar: script headless em
// scratchpad (Playwright, `?tune=1` não precisa) — bota o layout 1 no ar
// (`window.game.level`, modo Caçador ou Online, ambos layout 1 por padrão), roda
// `game.level.climbables.map(m => new THREE.Box3().setFromObject(m))`, serializa os
// 6 números de cada caixa (minX/maxX/minY/maxY/minZ/maxZ) e substitui o array abaixo.
export const LAYOUT_1_OCCLUDERS = [
  { minX: -14.5, maxX: 14.5, minY: 0, maxY: 7.8, minZ: -14.8, maxZ: -14.2 },
  { minX: -14.5, maxX: 14.5, minY: 0, maxY: 7.8, minZ: 14.2, maxZ: 14.8 },
  { minX: -14.8, maxX: -14.2, minY: 0, maxY: 7.8, minZ: -14.5, maxZ: 14.5 },
  { minX: 14.2, maxX: 14.8, minY: 0, maxY: 7.8, minZ: -14.5, maxZ: 14.5 },
  { minX: -14.5, maxX: -12.7, minY: 3.4, maxY: 5.8, minZ: -9.5, maxZ: -9.1 },
  { minX: -14.85, maxX: -13.05, minY: 3.4, maxY: 4.4, minZ: -12.65, maxZ: -12.35 },
  { minX: -13.55, maxX: -12.25, minY: 3.4, maxY: 5.4, minZ: -10.65, maxZ: -9.95 },
  { minX: -14.5, maxX: -12.7, minY: 3.4, maxY: 5.8, minZ: 9.1, maxZ: 9.5 },
  { minX: -14.85, maxX: -13.05, minY: 3.4, maxY: 4.4, minZ: 12.35, maxZ: 12.65 },
  { minX: -13.55, maxX: -12.25, minY: 3.4, maxY: 5.4, minZ: 9.95, maxZ: 10.65 },
  { minX: 12.7, maxX: 14.5, minY: 3.4, maxY: 5.8, minZ: -9.5, maxZ: -9.1 },
  { minX: 13.05, maxX: 14.85, minY: 3.4, maxY: 4.4, minZ: -12.65, maxZ: -12.35 },
  { minX: 12.25, maxX: 13.55, minY: 3.4, maxY: 5.4, minZ: -10.65, maxZ: -9.95 },
  { minX: 12.7, maxX: 14.5, minY: 3.4, maxY: 5.8, minZ: 9.1, maxZ: 9.5 },
  { minX: 13.05, maxX: 14.85, minY: 3.4, maxY: 4.4, minZ: 12.35, maxZ: 12.65 },
  { minX: 12.25, maxX: 13.55, minY: 3.4, maxY: 5.4, minZ: 9.95, maxZ: 10.65 },
  { minX: -14.25, maxX: -13.25, minY: 5.2, maxY: 6.7, minZ: 0.9, maxZ: 2.3 },
  { minX: -7.7, maxX: -6.3, minY: 3.4, maxY: 5.4, minZ: -4.4, maxZ: -3.6 },
  { minX: -7.7, maxX: -6.3, minY: 3.4, maxY: 5.4, minZ: 3.6, maxZ: 4.4 },
  { minX: 6.3, maxX: 7.7, minY: 3.4, maxY: 5.4, minZ: -4.4, maxZ: -3.6 },
  { minX: 6.3, maxX: 7.7, minY: 3.4, maxY: 5.4, minZ: 3.6, maxZ: 4.4 },
  { minX: 8.8, maxX: 10.2, minY: 3.4, maxY: 5.4, minZ: -0.4, maxZ: 0.4 },
  { minX: -4.65, maxX: -3.35, minY: 3.4, maxY: 4.6, minZ: -6.55, maxZ: -5.45 },
  { minX: -4.65, maxX: -3.35, minY: 3.4, maxY: 4.6, minZ: 5.45, maxZ: 6.55 },
  { minX: 3.35, maxX: 4.65, minY: 3.4, maxY: 4.6, minZ: -6.55, maxZ: -5.45 },
  { minX: 3.35, maxX: 4.65, minY: 3.4, maxY: 4.6, minZ: 5.45, maxZ: 6.55 },
  { minX: -6.15, maxX: -4.85, minY: 3.4, maxY: 4.6, minZ: -0.55, maxZ: 0.55 },
  { minX: 4.85, maxX: 6.15, minY: 3.4, maxY: 4.6, minZ: -0.55, maxZ: 0.55 },
  { minX: -8.58, maxX: -8.42, minY: 3.4, maxY: 5.2, minZ: -7.85, maxZ: -6.15 },
  { minX: 7.92, maxX: 8.08, minY: 3.4, maxY: 5.2, minZ: 5.65, maxZ: 7.35 },
  { minX: -4.55, maxX: -3.45, minY: 0, maxY: 7.8, minZ: -4.55, maxZ: -3.45 },
  { minX: 3.45, maxX: 4.55, minY: 0, maxY: 7.8, minZ: -4.55, maxZ: -3.45 },
  { minX: -4.55, maxX: -3.45, minY: 0, maxY: 7.8, minZ: 3.45, maxZ: 4.55 },
  { minX: 3.45, maxX: 4.55, minY: 0, maxY: 7.8, minZ: 3.45, maxZ: 4.55 },
  { minX: -12, maxX: -5, minY: 0, maxY: 3.2, minZ: -12.25, maxZ: -11.75 },
  { minX: -12, maxX: -10.1, minY: 0, maxY: 3.2, minZ: -5.25, maxZ: -4.75 },
  { minX: -6.9, maxX: -5, minY: 0, maxY: 3.2, minZ: -5.25, maxZ: -4.75 },
  { minX: -12.25, maxX: -11.75, minY: 0, maxY: 3.2, minZ: -12, maxZ: -5 },
  { minX: -5.25, maxX: -4.75, minY: 0, maxY: 3.2, minZ: -12, maxZ: -10.1 },
  { minX: -5.25, maxX: -4.75, minY: 0, maxY: 3.2, minZ: -6.9, maxZ: -5 },
  { minX: -12.1, maxX: -9.9, minY: 0, maxY: 2.8, minZ: -9.25, maxZ: -8.75 },
  { minX: -10.1, maxX: -7.9, minY: 0, maxY: 2.8, minZ: -11.25, maxZ: -10.75 },
  { minX: -8.25, maxX: -6.75, minY: 0.2, maxY: 1.2, minZ: -8.1, maxZ: -7.8 },
  { minX: 5, maxX: 12, minY: 0, maxY: 3.2, minZ: -12.25, maxZ: -11.75 },
  { minX: 5, maxX: 6.9, minY: 0, maxY: 3.2, minZ: -5.25, maxZ: -4.75 },
  { minX: 10.1, maxX: 12, minY: 0, maxY: 3.2, minZ: -5.25, maxZ: -4.75 },
  { minX: 4.75, maxX: 5.25, minY: 0, maxY: 3.2, minZ: -12, maxZ: -10.1 },
  { minX: 4.75, maxX: 5.25, minY: 0, maxY: 3.2, minZ: -6.9, maxZ: -5 },
  { minX: 11.75, maxX: 12.25, minY: 0, maxY: 3.2, minZ: -12, maxZ: -5 },
  { minX: 8.75, maxX: 10.25, minY: 0.2, maxY: 1.2, minZ: -10.1, maxZ: -9.8 },
  { minX: 10.05, maxX: 11.95, minY: 0, maxY: 1, minZ: -8.85, maxZ: -8.15 },
];

// Teste ray-AABB pelo método dos slabs — matemática pura, mesmo espírito de
// hittest.js:normalize. `dir` já precisa vir normalizada.
function rayIntersectsBox(origin, dir, maxDist, box) {
  let tmin = 0, tmax = maxDist;

  const axes = [
    ['x', box.minX, box.maxX],
    ['y', box.minY, box.maxY],
    ['z', box.minZ, box.maxZ],
  ];
  for (const [axis, min, max] of axes) {
    const o = origin[axis], d = dir[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < min || o > max) return false; // paralelo ao slab e fora dele: nunca cruza
      continue;
    }
    let t1 = (min - o) / d;
    let t2 = (max - o) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

// Verdadeiro se alguma caixa de `boxes` bloqueia a linha `origin` → `target` (subindo
// `target` pro tronco, mesma convenção de hittest.js:coneCandidates).
//
//   origin  {x,y,z}
//   target  {x,y,z} — posição RASA (pés), como vem de coneCandidates
//   boxes   [{minX,maxX,minY,maxY,minZ,maxZ}]
export function isOccluded(origin, target, boxes) {
  const dx = target.x - origin.x;
  const dy = target.y + AIM_UP_Y - origin.y;
  const dz = target.z - origin.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-3) return false;

  const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
  const maxDist = Math.max(0, dist - TARGET_MARGIN);

  for (const box of boxes) {
    if (rayIntersectsBox(origin, dir, maxDist, box)) return true;
  }
  return false;
}
