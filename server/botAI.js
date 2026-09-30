// IA dos Camaleões controlados pelo servidor (docs/PLANO_MELHORIAS_JOGO.md, etapa 2).
//
// Substitui a versão anterior, que sorteava pontos livres no chão e trocava a cor por
// um sorteio de paleta. Aqui a IA faz o que um Camaleão humano faz:
//   procurar esconderijo → ir até ele → copiar a superfície e parar → observar a
//   ameaça → fugir pra outro abrigo.
// Os esconderijos (server/navdata.js) são lugares onde o JOGO deixa grudar (mesmo
// `toggleLatch` do Player) e vêm com a cor que o jogo de fato mede ali — então um
// Caçador humano enxerga a IA exatamente como enxerga um Camaleão camuflado de verdade.
//
// Restrições que a IA respeita por desenho (o plano pede as MESMAS de um humano):
//  • só pisa em célula livre da grade (paredes, móveis, escadas e buracos bloqueados);
//  • anda bem abaixo da velocidade humana (8,25 m/s, Tuning.js) — é adversário, não
//    obstáculo impossível;
//  • percepção limitada: não conhece o Caçador o tempo todo. Só o "vê" dentro do
//    alcance, do campo de visão e sem parede no meio, ou o "ouve" bem de perto — e
//    lembra onde o viu por pouco tempo. A dificuldade vem do tempo de reação e da
//    qualidade da escolha, não de onisciência.
//
// Sem Three.js nem sockets: recebe o bot e um "mundo" (grade, Caçador, oclusores), o que
// torna o comportamento testável de forma determinística (server/test/botai.test.mjs).
import { GROUND_Y } from '../src/net/protocol.js';
import { isOccluded } from '../src/net/occluders.js';

export const AI = {
  WALK_SPEED: 2.4,        // m/s andando até um esconderijo
  FLEE_SPEED: 3.8,        // m/s fugindo
  SIGHT_RANGE: 12,        // m em que a IA enxerga o Caçador (sem parede no meio)
  SIGHT_HALF_FOV: (100 * Math.PI) / 180, // campo de visão de 200°: olhos nas laterais
  HEARING_RANGE: 3,       // m em que ouve o Caçador mesmo atrás de parede ou de costas
  ALERT_RANGE: 6.5,       // m: enxergando o Caçador mais perto que isto, a IA se assusta
  REACTION_MS: [450, 1000], // tempo de reação entre perceber e sair correndo
  MEMORY_MS: 10000,       // quanto tempo lembra de onde viu o Caçador
  HIDE_MS: [14000, 30000], // quanto tempo fica num esconderijo antes de trocar
  FLEE_MIN_DIST: 6,       // m: esconderijo novo tem que ficar longe de onde viu o Caçador
  ARRIVE_DIST: 0.12,
  STUCK_MS: 1800,         // sem progresso por este tempo → escolhe outro destino
  STUCK_MIN_MOVE: 0.25,   // m andados nessa janela pra contar como progresso
  RETRY_MS: 1500,         // sem destino possível: tenta de novo depois disto
  // Escolher destino faz um Dijkstra na grade (~10ms no maior mapa, 35 mil células).
  // Primeiro só até esta distância de caminho (~5ms, e sobram esconderijos de sobra
  // perto de qualquer ponto); o mapa inteiro só se nada qualificar aqui.
  NEAR_FLOOD_M: 45,
};

// LCG por bot (estado em bot._rng, semeado na criação) — determinístico, então um
// teste reproduz exatamente a mesma partida.
export function nextRandom(bot) {
  bot._rng = (Math.imul(bot._rng, 1664525) + 1013904223) >>> 0;
  return bot._rng / 0x100000000;
}
const between = (bot, [lo, hi]) => lo + nextRandom(bot) * (hi - lo);

// Diferença angular assinada em (-π, π].
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

export function initBotAI(bot, now) {
  bot._ai = {
    state: 'seeking',       // seeking | moving | fleeing | hiding | alert
    path: null, pathIdx: 0,
    spot: null,             // esconderijo atual (ou destino atual)
    lastSpot: -1,           // o último onde ficou — não repete em seguida
    badSpots: new Set(),    // destinos em que já travou nesta rodada
    memory: null,           // { x, z, at }: onde viu/ouviu o Caçador por último
    reactAt: 0, hideUntil: 0, retryAt: 0,
    gaze: bot.yaw || 0,     // pra onde a IA olha (campo de visão)
    lastAt: now,
    progressAt: now, progressPos: { x: bot.pos.x, z: bot.pos.z },
    recoveries: 0,
  };
  bot.moving = false;
}

// ------------------------------------------------------------------ percepção
function perceive(bot, world, now) {
  const ai = bot._ai;
  const hunter = world.hunter;
  let seen = false, heard = false, dist = Infinity;
  if (hunter) {
    dist = Math.hypot(hunter.pos.x - bot.pos.x, hunter.pos.z - bot.pos.z);
    heard = dist <= AI.HEARING_RANGE;
    if (!heard && dist <= AI.SIGHT_RANGE) {
      const toHunter = Math.atan2(hunter.pos.x - bot.pos.x, hunter.pos.z - bot.pos.z);
      if (Math.abs(angleDiff(toHunter, ai.gaze)) <= AI.SIGHT_HALF_FOV &&
          !isOccluded(bot.pos, hunter.pos, world.boxes)) seen = true;
    }
    if (seen || heard) ai.memory = { x: hunter.pos.x, z: hunter.pos.z, at: now };
  }
  if (ai.memory && now - ai.memory.at > AI.MEMORY_MS) ai.memory = null;
  return { seen, heard, dist, threat: heard || (seen && dist <= AI.ALERT_RANGE) };
}

// ------------------------------------------------------- escolha de esconderijo
// Devolve `true` (bot com `path`/`spot` prontos), `false` (não há destino) ou 'wait'
// (o orçamento de decisões deste tick acabou — não muda nada, tenta no próximo).
function chooseSpot(bot, world, now) {
  // Um Dijkstra por tick, no máximo: sem isto as 4 IAs decidem juntas no início da
  // partida e o tick de 50ms estoura (medido: 115ms no maior mapa, antes da otimização).
  if (world.budget) {
    if (world.budget.floods <= 0) return 'wait';
    world.budget.floods--;
  }
  const ai = bot._ai;
  const nav = world.nav;
  const start = nav.nearestFree(bot.pos.x, bot.pos.z, 6);
  if (!start) return false;
  const mem = ai.memory;
  const toMem = mem ? { x: mem.x - bot.pos.x, z: mem.z - bot.pos.z } : null;
  const memDist = toMem ? Math.hypot(toMem.x, toMem.z) : 0;

  const rank = (flood) => {
    let best = null, bestScore = -Infinity;
    for (const spot of nav.spots) {
      if (!spot.approach || spot.index === ai.lastSpot || ai.badSpots.has(spot.index)) continue;
      const owner = world.reserved.get(spot.index);
      if (owner && owner !== bot.id && world.botIds.has(owner)) continue;
      const d = flood.dist[nav.idx(spot.approach.c, spot.approach.r)];
      if (!Number.isFinite(d)) continue;

      // Perto é melhor, mas pouco (a IA não deve sempre escolher o abrigo mais próximo) —
      // e um sorteio por cima pra duas IAs na mesma situação não escolherem igual.
      let score = -0.4 * d + nextRandom(bot) * 8;
      if (mem) {
        const dh = Math.hypot(spot.x - mem.x, spot.z - mem.z);
        if (dh < AI.FLEE_MIN_DIST) continue;
        // Não escolhe abrigo que exija passar pelo Caçador: na direção dele e além dele.
        const toSpot = { x: spot.x - bot.pos.x, z: spot.z - bot.pos.z };
        const spotDist = Math.hypot(toSpot.x, toSpot.z);
        if (spotDist > memDist && memDist > 0.5 &&
            (toSpot.x * toMem.x + toSpot.z * toMem.z) / (spotDist * memDist) > 0.5) continue;
        score += Math.min(dh, 30);
        // Fora da linha de visão de onde o viu vale muito: é o que um humano procura.
        if (isOccluded({ x: mem.x, y: GROUND_Y, z: mem.z }, { x: spot.x, y: GROUND_Y, z: spot.z }, world.boxes)) score += 12;
      }
      if (score > bestScore) { bestScore = score; best = spot; }
    }
    return best;
  };

  let flood = nav.flood(start, AI.NEAR_FLOOD_M);
  let best = rank(flood);
  if (!best) { flood = nav.flood(start); best = rank(flood); }
  if (!best) return false;

  const cells = nav.pathTo(flood, best.approach);
  if (!cells) return false;
  const path = nav.simplify(cells);
  path.push({ x: best.x, z: best.z }); // último passo, reto, até o ponto exato do esconderijo

  if (ai.spot) world.reserved.delete(ai.spot.index);
  world.reserved.set(best.index, bot.id);
  ai.spot = best;
  ai.path = path;
  ai.pathIdx = 0;
  ai.progressAt = now;
  ai.progressPos = { x: bot.pos.x, z: bot.pos.z };
  return true;
}

// ------------------------------------------------------------------ transições
function unhide(bot) {
  bot.state = 'grounded';
  bot.prone = false;
  bot.statue = false;
}

function settle(bot, spot, now) {
  const ai = bot._ai;
  bot.pos = { x: spot.x, y: GROUND_Y, z: spot.z };
  bot.yaw = spot.yaw;
  bot.moving = false;
  bot.statue = true;
  if (spot.kind === 'w') { bot.state = 'latched'; bot.prone = false; }
  else { bot.state = 'grounded'; bot.prone = true; }
  // A cópia da superfície: as cores que o jogo mede atrás de cada zona do corpo.
  bot.color = [spot.upper, spot.lower];
  ai.state = 'hiding';
  ai.gaze = spot.gaze;
  ai.hideUntil = now + between(bot, AI.HIDE_MS);
  ai.lastSpot = spot.index;
  ai.path = null;
}

function beginTravel(bot, now, fleeing) {
  const ai = bot._ai;
  unhide(bot);
  ai.state = fleeing ? 'fleeing' : 'moving';
  bot.moving = true;
  ai.lastAt = now;
}

function recover(bot, world, now) {
  const ai = bot._ai;
  ai.recoveries++;
  if (ai.spot) { ai.badSpots.add(ai.spot.index); world.reserved.delete(ai.spot.index); ai.spot = null; }
  ai.path = null;
  ai.state = 'seeking';
  ai.retryAt = 0;
  bot.moving = false;
}

function walk(bot, world, now, dt) {
  const ai = bot._ai;
  const wp = ai.path[ai.pathIdx];
  const speed = ai.state === 'fleeing' ? AI.FLEE_SPEED : AI.WALK_SPEED;
  const dx = wp.x - bot.pos.x;
  const dz = wp.z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  const step = speed * dt;

  if (dist <= Math.max(step, AI.ARRIVE_DIST)) {
    bot.pos = { x: wp.x, y: GROUND_Y, z: wp.z };
    ai.pathIdx++;
    if (ai.pathIdx >= ai.path.length) { settle(bot, ai.spot, now); return; }
  } else {
    bot.pos = { x: bot.pos.x + (dx / dist) * step, y: GROUND_Y, z: bot.pos.z + (dz / dist) * step };
    bot.yaw = Math.atan2(dx, dz);
    ai.gaze = bot.yaw;
  }
  bot.moving = true;

  if (now - ai.progressAt >= AI.STUCK_MS) {
    const moved = Math.hypot(bot.pos.x - ai.progressPos.x, bot.pos.z - ai.progressPos.z);
    if (moved < AI.STUCK_MIN_MOVE) { recover(bot, world, now); return; }
    ai.progressAt = now;
    ai.progressPos = { x: bot.pos.x, z: bot.pos.z };
  }
}

// -------------------------------------------------------------------- um passo
// `world`: { nav, hunter, boxes, reserved: Map<spotIndex, botId>, botIds: Set }.
export function updateBotAI(bot, world, now) {
  const ai = bot._ai;
  if (!ai || !world.nav) return;
  if (bot.eliminated) { bot.moving = false; return; }
  const dt = Math.min(0.1, Math.max(0, (now - ai.lastAt) / 1000));
  ai.lastAt = now;

  const senses = perceive(bot, world, now);

  switch (ai.state) {
    case 'seeking': {
      if (now < ai.retryAt) return;
      const chosen = chooseSpot(bot, world, now);
      if (chosen === 'wait') return;
      if (chosen) beginTravel(bot, now, false);
      else ai.retryAt = now + AI.RETRY_MS;
      return;
    }

    case 'moving':
      // Andando e dando de cara com o Caçador: não há esconderijo a proteger, corre.
      if (senses.threat && chooseSpot(bot, world, now) === true) { beginTravel(bot, now, true); return; }
      walk(bot, world, now, dt);
      return;

    case 'fleeing':
      walk(bot, world, now, dt);
      return;

    case 'hiding':
      if (senses.threat) { ai.state = 'alert'; ai.reactAt = now + between(bot, AI.REACTION_MS); return; }
      if (now >= ai.hideUntil) {
        // Troca de lugar de tempos em tempos: uma IA que nunca sai do esconderijo é
        // varrida pelo Scanner em um minuto.
        const chosen = chooseSpot(bot, world, now);
        if (chosen === 'wait') return;
        if (chosen) beginTravel(bot, now, false);
        else ai.hideUntil = now + AI.RETRY_MS;
      }
      return;

    case 'alert': {
      // Reação leva tempo; se o Caçador some antes disso, foi alarme falso e segue parada.
      if (!senses.threat) { ai.state = 'hiding'; return; }
      if (now >= ai.reactAt) {
        const chosen = chooseSpot(bot, world, now);
        if (chosen === 'wait') return; // espera o próximo tick: a IA continua parada
        if (chosen) beginTravel(bot, now, true);
        else ai.state = 'hiding'; // sem pra onde ir: congela
      }
      return;
    }
  }
}
