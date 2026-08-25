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
//
// Dois snapshots hoje — um por layout elegível pro Online (protocol.js:ONLINE_LAYOUTS)
// — escolhidos por `OCCLUDERS_BY_LAYOUT[layout]` em room.js.

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
  { minX: -14.5, maxX: 14.5, minY: 0, maxY: 10.8, minZ: -14.8, maxZ: -14.2 },
  { minX: -14.5, maxX: 14.5, minY: 0, maxY: 10.8, minZ: 14.2, maxZ: 14.8 },
  { minX: -14.8, maxX: -14.2, minY: 0, maxY: 10.8, minZ: -14.5, maxZ: 14.5 },
  { minX: 14.2, maxX: 14.8, minY: 0, maxY: 10.8, minZ: -14.5, maxZ: 14.5 },
  { minX: -14.5, maxX: -12.7, minY: 6.4, maxY: 10.8, minZ: -9.5, maxZ: -9.1 },
  { minX: -14.85, maxX: -13.05, minY: 6.4, maxY: 7.4, minZ: -12.65, maxZ: -12.35 },
  { minX: -13.55, maxX: -12.25, minY: 6.4, maxY: 8.4, minZ: -10.65, maxZ: -9.95 },
  { minX: -14.5, maxX: -12.7, minY: 6.4, maxY: 10.8, minZ: 9.1, maxZ: 9.5 },
  { minX: -14.85, maxX: -13.05, minY: 6.4, maxY: 7.4, minZ: 12.35, maxZ: 12.65 },
  { minX: -13.55, maxX: -12.25, minY: 6.4, maxY: 8.4, minZ: 9.95, maxZ: 10.65 },
  { minX: 12.7, maxX: 14.5, minY: 6.4, maxY: 10.8, minZ: -9.5, maxZ: -9.1 },
  { minX: 13.05, maxX: 14.85, minY: 6.4, maxY: 7.4, minZ: -12.65, maxZ: -12.35 },
  { minX: 12.25, maxX: 13.55, minY: 6.4, maxY: 8.4, minZ: -10.65, maxZ: -9.95 },
  { minX: 12.7, maxX: 14.5, minY: 6.4, maxY: 10.8, minZ: 9.1, maxZ: 9.5 },
  { minX: 13.05, maxX: 14.85, minY: 6.4, maxY: 7.4, minZ: 12.35, maxZ: 12.65 },
  { minX: 12.25, maxX: 13.55, minY: 6.4, maxY: 8.4, minZ: 9.95, maxZ: 10.65 },
  { minX: -14.25, maxX: -13.25, minY: 8.2, maxY: 9.7, minZ: 0.9, maxZ: 2.3 },
  { minX: -7.7, maxX: -6.3, minY: 6.4, maxY: 8.4, minZ: -4.4, maxZ: -3.6 },
  { minX: -7.7, maxX: -6.3, minY: 6.4, maxY: 8.4, minZ: 3.6, maxZ: 4.4 },
  { minX: 6.3, maxX: 7.7, minY: 6.4, maxY: 8.4, minZ: -4.4, maxZ: -3.6 },
  { minX: 6.3, maxX: 7.7, minY: 6.4, maxY: 8.4, minZ: 3.6, maxZ: 4.4 },
  { minX: 8.8, maxX: 10.2, minY: 6.4, maxY: 8.4, minZ: -0.4, maxZ: 0.4 },
  { minX: -4.65, maxX: -3.35, minY: 6.4, maxY: 7.6, minZ: -6.55, maxZ: -5.45 },
  { minX: -4.65, maxX: -3.35, minY: 6.4, maxY: 7.6, minZ: 5.45, maxZ: 6.55 },
  { minX: 3.35, maxX: 4.65, minY: 6.4, maxY: 7.6, minZ: -6.55, maxZ: -5.45 },
  { minX: 3.35, maxX: 4.65, minY: 6.4, maxY: 7.6, minZ: 5.45, maxZ: 6.55 },
  { minX: -6.15, maxX: -4.85, minY: 6.4, maxY: 7.6, minZ: -0.55, maxZ: 0.55 },
  { minX: 4.85, maxX: 6.15, minY: 6.4, maxY: 7.6, minZ: -0.55, maxZ: 0.55 },
  { minX: -8.58, maxX: -8.42, minY: 6.4, maxY: 8.2, minZ: -7.85, maxZ: -6.15 },
  { minX: 7.92, maxX: 8.08, minY: 6.4, maxY: 8.2, minZ: 5.65, maxZ: 7.35 },
  { minX: -4.55, maxX: -3.45, minY: 0, maxY: 10.8, minZ: -4.55, maxZ: -3.45 },
  { minX: 3.45, maxX: 4.55, minY: 0, maxY: 10.8, minZ: -4.55, maxZ: -3.45 },
  { minX: -4.55, maxX: -3.45, minY: 0, maxY: 10.8, minZ: 3.45, maxZ: 4.55 },
  { minX: 3.45, maxX: 4.55, minY: 0, maxY: 10.8, minZ: 3.45, maxZ: 4.55 },
  { minX: -12, maxX: -5, minY: 0, maxY: 6.2, minZ: -12.25, maxZ: -11.75 },
  { minX: -12, maxX: -10.1, minY: 0, maxY: 6.2, minZ: -5.25, maxZ: -4.75 },
  { minX: -6.9, maxX: -5, minY: 0, maxY: 6.2, minZ: -5.25, maxZ: -4.75 },
  { minX: -12.25, maxX: -11.75, minY: 0, maxY: 6.2, minZ: -12, maxZ: -5 },
  { minX: -5.25, maxX: -4.75, minY: 0, maxY: 6.2, minZ: -12, maxZ: -10.1 },
  { minX: -5.25, maxX: -4.75, minY: 0, maxY: 6.2, minZ: -6.9, maxZ: -5 },
  { minX: -12.1, maxX: -9.9, minY: 0, maxY: 2.8, minZ: -9.25, maxZ: -8.75 },
  { minX: -10.1, maxX: -7.9, minY: 0, maxY: 2.8, minZ: -11.25, maxZ: -10.75 },
  { minX: -8.25, maxX: -6.75, minY: 0.2, maxY: 1.2, minZ: -8.1, maxZ: -7.8 },
  { minX: 5, maxX: 12, minY: 0, maxY: 6.2, minZ: -12.25, maxZ: -11.75 },
  { minX: 5, maxX: 6.9, minY: 0, maxY: 6.2, minZ: -5.25, maxZ: -4.75 },
  { minX: 10.1, maxX: 12, minY: 0, maxY: 6.2, minZ: -5.25, maxZ: -4.75 },
  { minX: 4.75, maxX: 5.25, minY: 0, maxY: 6.2, minZ: -12, maxZ: -10.1 },
  { minX: 4.75, maxX: 5.25, minY: 0, maxY: 6.2, minZ: -6.9, maxZ: -5 },
  { minX: 11.75, maxX: 12.25, minY: 0, maxY: 6.2, minZ: -12, maxZ: -5 },
  { minX: 8.75, maxX: 10.25, minY: 0.2, maxY: 1.2, minZ: -10.1, maxZ: -9.8 },
  { minX: 10.05, maxX: 11.95, minY: 0, maxY: 1, minZ: -8.85, maxZ: -8.15 },
];

// Mesmo snapshot, layout 4 (fábrica abandonada — ver Level.js:_buildFactoryLevel).
// Mesma fragilidade/processo de regeneração do LAYOUT_1_OCCLUDERS acima: pra
// regerar, forçar `sessionStorage['eom-stage']='4'` antes de montar o modo Caçador
// solo (dá layout 4), rodar o mesmo `game.level.climbables.map(...)`.
export const LAYOUT_4_OCCLUDERS = [
  { minX: -14.5, maxX: 14.5, minY: 0, maxY: 7.6, minZ: -14.8, maxZ: -14.2 },
  { minX: -14.5, maxX: 14.5, minY: 0, maxY: 7.6, minZ: 14.2, maxZ: 14.8 },
  { minX: -14.8, maxX: -14.2, minY: 0, maxY: 7.6, minZ: -14.5, maxZ: 14.5 },
  { minX: 14.2, maxX: 14.8, minY: 0, maxY: 7.6, minZ: -14.5, maxZ: 14.5 },
  { minX: -11.5, maxX: -4.5, minY: 0, maxY: 5.2, minZ: -11.75, maxZ: -11.25 },
  { minX: -11.5, maxX: -9.6, minY: 0, maxY: 5.2, minZ: -4.75, maxZ: -4.25 },
  { minX: -6.4, maxX: -4.5, minY: 0, maxY: 5.2, minZ: -4.75, maxZ: -4.25 },
  { minX: -11.75, maxX: -11.25, minY: 0, maxY: 5.2, minZ: -11.5, maxZ: -4.5 },
  { minX: -4.75, maxX: -4.25, minY: 0, maxY: 5.2, minZ: -11.5, maxZ: -9.6 },
  { minX: -4.75, maxX: -4.25, minY: 0, maxY: 5.2, minZ: -6.4, maxZ: -4.5 },
  { minX: 4.5, maxX: 11.5, minY: 0, maxY: 5.2, minZ: -11.75, maxZ: -11.25 },
  { minX: 4.5, maxX: 6.4, minY: 0, maxY: 5.2, minZ: -4.75, maxZ: -4.25 },
  { minX: 9.6, maxX: 11.5, minY: 0, maxY: 5.2, minZ: -4.75, maxZ: -4.25 },
  { minX: 4.25, maxX: 4.75, minY: 0, maxY: 5.2, minZ: -11.5, maxZ: -9.6 },
  { minX: 4.25, maxX: 4.75, minY: 0, maxY: 5.2, minZ: -6.4, maxZ: -4.5 },
  { minX: 11.25, maxX: 11.75, minY: 0, maxY: 5.2, minZ: -11.5, maxZ: -4.5 },
  { minX: -11.5, maxX: -9.6, minY: 0, maxY: 5.2, minZ: 4.25, maxZ: 4.75 },
  { minX: -6.4, maxX: -4.5, minY: 0, maxY: 5.2, minZ: 4.25, maxZ: 4.75 },
  { minX: -11.5, maxX: -4.5, minY: 0, maxY: 5.2, minZ: 11.25, maxZ: 11.75 },
  { minX: -11.75, maxX: -11.25, minY: 0, maxY: 5.2, minZ: 4.5, maxZ: 11.5 },
  { minX: -4.75, maxX: -4.25, minY: 0, maxY: 5.2, minZ: 4.5, maxZ: 6.4 },
  { minX: -4.75, maxX: -4.25, minY: 0, maxY: 5.2, minZ: 9.6, maxZ: 11.5 },
  { minX: 4.5, maxX: 6.4, minY: 0, maxY: 5.2, minZ: 4.25, maxZ: 4.75 },
  { minX: 9.6, maxX: 11.5, minY: 0, maxY: 5.2, minZ: 4.25, maxZ: 4.75 },
  { minX: 4.5, maxX: 11.5, minY: 0, maxY: 5.2, minZ: 11.25, maxZ: 11.75 },
  { minX: 4.25, maxX: 4.75, minY: 0, maxY: 5.2, minZ: 4.5, maxZ: 6.4 },
  { minX: 4.25, maxX: 4.75, minY: 0, maxY: 5.2, minZ: 9.6, maxZ: 11.5 },
  { minX: 11.25, maxX: 11.75, minY: 0, maxY: 5.2, minZ: 4.5, maxZ: 11.5 },
  { minX: -4.2, maxX: -1.8, minY: 0, maxY: 3.2, minZ: -4.2, maxZ: -1.8 },
  { minX: 1.8, maxX: 4.2, minY: 0, maxY: 3.2, minZ: 1.8, maxZ: 4.2 },
  { minX: 4, maxX: 5, minY: 0, maxY: 1, minZ: -5, maxZ: -4 },
  { minX: -5, maxX: -4, minY: 0, maxY: 1, minZ: 4, maxZ: 5 },
  { minX: 5, maxX: 6, minY: 0, maxY: 1, minZ: -3.7, maxZ: -2.7 },
  { minX: -6, maxX: -5, minY: 0, maxY: 1, minZ: 2.7, maxZ: 3.7 },
];

// Mesmo snapshot, layout 5 (Chameleon Manor — Plano 5). Mesma fragilidade/processo de
// regeneração dos dois acima: pra regerar, `new Level(scene, 5)` (headless, mesmo
// padrão usado em toda verificação deste mapa) e
// `level.climbables.map(m => new THREE.Box3().setFromObject(m))`.
// 121 entradas — bem mais que layout 1 (91) ou 4 (33): o mapa tem 4 níveis físicos
// (porão/térreo/1º andar/ático) em vez de 1-3, cada um com sua própria geometria.
export const LAYOUT_5_OCCLUDERS = [
  { minX: -60, maxX: 60, minY: -3, maxY: 0, minZ: -40.3, maxZ: -39.7 },
  { minX: -60, maxX: 60, minY: -3, maxY: 0, minZ: 39.7, maxZ: 40.3 },
  { minX: -60.3, maxX: -59.7, minY: -3, maxY: 0, minZ: -40, maxZ: 40 },
  { minX: 59.7, maxX: 60.3, minY: -3, maxY: 0, minZ: -40, maxZ: 40 },
  { minX: -60, maxX: 60, minY: 0, maxY: 4.5, minZ: -40.3, maxZ: -39.7 },
  { minX: -60, maxX: 60, minY: 0, maxY: 4.5, minZ: 39.7, maxZ: 40.3 },
  { minX: -60.3, maxX: -59.7, minY: 0, maxY: 4.5, minZ: -40, maxZ: 40 },
  { minX: 59.7, maxX: 60.3, minY: 0, maxY: 4.5, minZ: -40, maxZ: 40 },
  { minX: -60, maxX: 60, minY: 4.5, maxY: 8.5, minZ: -40.3, maxZ: -39.7 },
  { minX: -60, maxX: 60, minY: 4.5, maxY: 8.5, minZ: 39.7, maxZ: 40.3 },
  { minX: -60.3, maxX: -59.7, minY: 4.5, maxY: 8.5, minZ: -40, maxZ: 40 },
  { minX: 59.7, maxX: 60.3, minY: 4.5, maxY: 8.5, minZ: -40, maxZ: 40 },
  { minX: -60, maxX: 60, minY: 8.5, maxY: 11, minZ: -40.3, maxZ: -39.7 },
  { minX: -60, maxX: 60, minY: 8.5, maxY: 11, minZ: 39.7, maxZ: 40.3 },
  { minX: -60.3, maxX: -59.7, minY: 8.5, maxY: 11, minZ: -40, maxZ: 40 },
  { minX: 59.7, maxX: 60.3, minY: 8.5, maxY: 11, minZ: -40, maxZ: 40 },
  { minX: -48, maxX: -41.6, minY: -3, maxY: 0, minZ: -8.3, maxZ: -7.7 },
  { minX: -38.4, maxX: -32, minY: -3, maxY: 0, minZ: -8.3, maxZ: -7.7 },
  { minX: -48, maxX: -32, minY: -3, maxY: 0, minZ: 7.7, maxZ: 8.3 },
  { minX: -48.3, maxX: -47.7, minY: -3, maxY: 0, minZ: -8, maxZ: 8 },
  { minX: -32.3, maxX: -31.7, minY: -3, maxY: 0, minZ: -8, maxZ: -1.6 },
  { minX: -32.3, maxX: -31.7, minY: -3, maxY: 0, minZ: 1.6, maxZ: 8 },
  { minX: -18, maxX: -2, minY: -3, maxY: 0, minZ: -8.3, maxZ: -7.7 },
  { minX: -18, maxX: -11.6, minY: -3, maxY: 0, minZ: 7.7, maxZ: 8.3 },
  { minX: -8.4, maxX: -2, minY: -3, maxY: 0, minZ: 7.7, maxZ: 8.3 },
  { minX: -18.3, maxX: -17.7, minY: -3, maxY: 0, minZ: -8, maxZ: -1.6 },
  { minX: -18.3, maxX: -17.7, minY: -3, maxY: 0, minZ: 1.6, maxZ: 8 },
  { minX: -2.3, maxX: -1.7, minY: -3, maxY: 0, minZ: -8, maxZ: 8 },
  { minX: -17, maxX: -11.6, minY: -3, maxY: 0, minZ: 18.7, maxZ: 19.3 },
  { minX: -8.4, maxX: -3, minY: -3, maxY: 0, minZ: 18.7, maxZ: 19.3 },
  { minX: -17, maxX: -3, minY: -3, maxY: 0, minZ: 30.7, maxZ: 31.3 },
  { minX: -17.3, maxX: -16.7, minY: -3, maxY: 0, minZ: 19, maxZ: 23.4 },
  { minX: -17.3, maxX: -16.7, minY: -3, maxY: 0, minZ: 26.6, maxZ: 31 },
  { minX: -3.3, maxX: -2.7, minY: -3, maxY: 0, minZ: 19, maxZ: 31 },
  { minX: -36.5, maxX: -35.5, minY: -3, maxY: -2, minZ: 4.5, maxZ: 5.5 },
  { minX: -35.15, maxX: -34.25, minY: -3, maxY: -2.1, minZ: 4.85, maxZ: 5.75 },
  { minX: -35.93, maxX: -35.07, minY: -3, maxY: -2.15, minZ: 5.77, maxZ: 6.63 },
  { minX: -4, maxX: -3, minY: -3, maxY: -1.7, minZ: -4.5, maxZ: -3.5 },
  { minX: -4, maxX: -3, minY: -3, maxY: -1.7, minZ: -1.5, maxZ: -0.5 },
  { minX: -4, maxX: -3, minY: -3, maxY: -1.7, minZ: 1.5, maxZ: 2.5 },
  { minX: -4, maxX: -3, minY: -3, maxY: -1.7, minZ: 4.5, maxZ: 5.5 },
  { minX: -18, maxX: 18, minY: 0, maxY: 4.5, minZ: -20.3, maxZ: -19.7 },
  { minX: -18, maxX: -1.6, minY: 0, maxY: 4.5, minZ: 3.7, maxZ: 4.3 },
  { minX: 1.6, maxX: 18, minY: 0, maxY: 4.5, minZ: 3.7, maxZ: 4.3 },
  { minX: -18.3, maxX: -17.7, minY: 0, maxY: 4.5, minZ: -20, maxZ: -9.6 },
  { minX: -18.3, maxX: -17.7, minY: 0, maxY: 4.5, minZ: -6.4, maxZ: 4 },
  { minX: 17.7, maxX: 18.3, minY: 0, maxY: 4.5, minZ: -20, maxZ: -9.6 },
  { minX: 17.7, maxX: 18.3, minY: 0, maxY: 4.5, minZ: -6.4, maxZ: 4 },
  { minX: -10, maxX: -1.6, minY: 0, maxY: 4.5, minZ: 9.7, maxZ: 10.3 },
  { minX: 1.6, maxX: 10, minY: 0, maxY: 4.5, minZ: 9.7, maxZ: 10.3 },
  { minX: -10, maxX: -1.6, minY: 0, maxY: 4.5, minZ: 25.7, maxZ: 26.3 },
  { minX: 1.6, maxX: 10, minY: 0, maxY: 4.5, minZ: 25.7, maxZ: 26.3 },
  { minX: -10.3, maxX: -9.7, minY: 0, maxY: 4.5, minZ: 10, maxZ: 26 },
  { minX: 9.7, maxX: 10.3, minY: 0, maxY: 4.5, minZ: 10, maxZ: 26 },
  { minX: 9.45, maxX: 10.55, minY: 0, maxY: 4.2, minZ: -8.55, maxZ: -7.45 },
  { minX: 2.54, maxX: 3.64, minY: 0, maxY: 4.2, minZ: 0.96, maxZ: 2.06 },
  { minX: -8.64, maxX: -7.54, minY: 0, maxY: 4.2, minZ: -2.67, maxZ: -1.57 },
  { minX: -8.64, maxX: -7.54, minY: 0, maxY: 4.2, minZ: -14.43, maxZ: -13.33 },
  { minX: 2.54, maxX: 3.64, minY: 0, maxY: 4.2, minZ: -18.06, maxZ: -16.96 },
  { minX: -0.55, maxX: 0.55, minY: 0, maxY: 4.2, minZ: -13.55, maxZ: -12.45 },
  { minX: 16.6, maxX: 18.2, minY: 0, maxY: 3.5, minZ: -2.15, maxZ: -1.85 },
  { minX: 20, maxX: 54, minY: 0, maxY: 4.5, minZ: -18.3, maxZ: -17.7 },
  { minX: 20, maxX: 54, minY: 0, maxY: 4.5, minZ: 1.7, maxZ: 2.3 },
  { minX: 19.7, maxX: 20.3, minY: 0, maxY: 4.5, minZ: -18, maxZ: -9.6 },
  { minX: 19.7, maxX: 20.3, minY: 0, maxY: 4.5, minZ: -6.4, maxZ: 2 },
  { minX: 53.7, maxX: 54.3, minY: 0, maxY: 4.5, minZ: -18, maxZ: 2 },
  { minX: -54, maxX: -20, minY: 0, maxY: 4.5, minZ: -18.3, maxZ: -17.7 },
  { minX: -54, maxX: -20, minY: 0, maxY: 4.5, minZ: 1.7, maxZ: 2.3 },
  { minX: -54.3, maxX: -53.7, minY: 0, maxY: 4.5, minZ: -18, maxZ: 2 },
  { minX: -20.3, maxX: -19.7, minY: 0, maxY: 4.5, minZ: -18, maxZ: -9.6 },
  { minX: -20.3, maxX: -19.7, minY: 0, maxY: 4.5, minZ: -6.4, maxZ: 2 },
  { minX: -51.1, maxX: -48.9, minY: 0, maxY: 2.8, minZ: 0.75, maxZ: 1.25 },
  { minX: -39.1, maxX: -36.9, minY: 0, maxY: 2.8, minZ: 0.75, maxZ: 1.25 },
  { minX: -31.1, maxX: -28.9, minY: 0, maxY: 2.8, minZ: 0.75, maxZ: 1.25 },
  { minX: -45.1, maxX: -42.9, minY: 0, maxY: 2.8, minZ: 0.75, maxZ: 1.25 },
  { minX: -7, maxX: -1.6, minY: 0, maxY: 4.5, minZ: 27.7, maxZ: 28.3 },
  { minX: 1.6, maxX: 7, minY: 0, maxY: 4.5, minZ: 27.7, maxZ: 28.3 },
  { minX: -7, maxX: 7, minY: 0, maxY: 4.5, minZ: 35.7, maxZ: 36.3 },
  { minX: -7.3, maxX: -6.7, minY: 0, maxY: 4.5, minZ: 28, maxZ: 36 },
  { minX: 6.7, maxX: 7.3, minY: 0, maxY: 4.5, minZ: 28, maxZ: 30.4 },
  { minX: 6.7, maxX: 7.3, minY: 0, maxY: 4.5, minZ: 33.6, maxZ: 36 },
  { minX: 8, maxX: 18, minY: 0, maxY: 4.5, minZ: 26.7, maxZ: 27.3 },
  { minX: 8, maxX: 18, minY: 0, maxY: 4.5, minZ: 36.7, maxZ: 37.3 },
  { minX: 7.7, maxX: 8.3, minY: 0, maxY: 4.5, minZ: 27, maxZ: 30.4 },
  { minX: 7.7, maxX: 8.3, minY: 0, maxY: 4.5, minZ: 33.6, maxZ: 37 },
  { minX: 17.7, maxX: 18.3, minY: 0, maxY: 4.5, minZ: 27, maxZ: 37 },
  { minX: -49, maxX: -21, minY: 4.5, maxY: 8.5, minZ: -18.3, maxZ: -17.7 },
  { minX: -49, maxX: -36.6, minY: 4.5, maxY: 8.5, minZ: 1.7, maxZ: 2.3 },
  { minX: -33.4, maxX: -21, minY: 4.5, maxY: 8.5, minZ: 1.7, maxZ: 2.3 },
  { minX: -49.3, maxX: -48.7, minY: 4.5, maxY: 8.5, minZ: -18, maxZ: 2 },
  { minX: -21.3, maxX: -20.7, minY: 4.5, maxY: 8.5, minZ: -18, maxZ: -9.6 },
  { minX: -21.3, maxX: -20.7, minY: 4.5, maxY: 8.5, minZ: -6.4, maxZ: 2 },
  { minX: -36.2, maxX: -33.8, minY: 0.1, maxY: 1.4, minZ: -16.15, maxZ: -15.85 },
  { minX: -49, maxX: -36.6, minY: 4.5, maxY: 8.5, minZ: 11.7, maxZ: 12.3 },
  { minX: -33.4, maxX: -21, minY: 4.5, maxY: 8.5, minZ: 11.7, maxZ: 12.3 },
  { minX: -49, maxX: -21, minY: 4.5, maxY: 8.5, minZ: 27.7, maxZ: 28.3 },
  { minX: -49.3, maxX: -48.7, minY: 4.5, maxY: 8.5, minZ: 12, maxZ: 28 },
  { minX: -21.3, maxX: -20.7, minY: 4.5, maxY: 8.5, minZ: 12, maxZ: 19.2 },
  { minX: -21.3, maxX: -20.7, minY: 4.5, maxY: 8.5, minZ: 20.8, maxZ: 28 },
  { minX: -21.3, maxX: -20.7, minY: 4.5, maxY: 8.5, minZ: 19.2, maxZ: 20.8 },
  { minX: -19, maxX: -3, minY: 4.5, maxY: 8.5, minZ: 11.7, maxZ: 12.3 },
  { minX: -19, maxX: -3, minY: 4.5, maxY: 8.5, minZ: 27.7, maxZ: 28.3 },
  { minX: -19.3, maxX: -18.7, minY: 4.5, maxY: 8.5, minZ: 12, maxZ: 18.4 },
  { minX: -19.3, maxX: -18.7, minY: 4.5, maxY: 8.5, minZ: 21.6, maxZ: 28 },
  { minX: -3.3, maxX: -2.7, minY: 4.5, maxY: 8.5, minZ: 12, maxZ: 28 },
  { minX: -8.45, maxX: -7.55, minY: 4.5, maxY: 5.4, minZ: 23.55, maxZ: 24.45 },
  { minX: -6.9, maxX: -6.1, minY: 4.5, maxY: 5.3, minZ: 24.6, maxZ: 25.4 },
  { minX: -14.43, maxX: -13.57, minY: 4.5, maxY: 5.35, minZ: 14.57, maxZ: 15.43 },
  { minX: 15, maxX: 35, minY: 4.5, maxY: 8.5, minZ: -16.3, maxZ: -15.7 },
  { minX: 15, maxX: 35, minY: 4.5, maxY: 8.5, minZ: -0.3, maxZ: 0.3 },
  { minX: 14.7, maxX: 15.3, minY: 4.5, maxY: 8.5, minZ: -16, maxZ: -9.6 },
  { minX: 14.7, maxX: 15.3, minY: 4.5, maxY: 8.5, minZ: -6.4, maxZ: 0 },
  { minX: 34.7, maxX: 35.3, minY: 4.5, maxY: 8.5, minZ: -16, maxZ: 0 },
  { minX: -3, maxX: 3, minY: 10.52, maxY: 10.68, minZ: -11, maxZ: -5 },
  { minX: -47, maxX: -37, minY: 10.45, maxY: 10.75, minZ: -30.25, maxZ: -29.75 },
  { minX: 39.3, maxX: 40.7, minY: 8, maxY: 11.5, minZ: 14.3, maxZ: 15.7 },
  { minX: -35.55, maxX: -34.45, minY: 8.5, maxY: 9.2, minZ: 14.65, maxZ: 15.35 },
  { minX: -34.05, maxX: -32.95, minY: 8.5, maxY: 9.2, minZ: 15.65, maxZ: 16.35 },
  { minX: 29.45, maxX: 30.55, minY: 8.5, maxY: 9.2, minZ: -25.35, maxZ: -24.65 },
  { minX: 44.45, maxX: 45.55, minY: 8.5, maxY: 9.2, minZ: -10.35, maxZ: -9.65 },
  { minX: -45.55, maxX: -44.45, minY: 8.5, maxY: 9.2, minZ: 9.65, maxZ: 10.35 },
];

// Lookup por número de layout — room.js usa `onlineLayoutFor()` (protocol.js) pra
// saber qual sala usar qual tabela, sem precisar de um switch espalhado por lá.
export const OCCLUDERS_BY_LAYOUT = {
  1: LAYOUT_1_OCCLUDERS,
  4: LAYOUT_4_OCCLUDERS,
  5: LAYOUT_5_OCCLUDERS,
};

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
