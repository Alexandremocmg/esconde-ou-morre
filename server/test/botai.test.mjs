// IA dos Camaleões do servidor (server/botAI.js + server/nav.js + server/navdata.js).
//
// Tudo aqui roda SEM socket e com relógio sintético: uma `Room` sem `start()`, um
// Caçador falso e `_updateBots(t)` chamado à mão com t crescendo de 50 em 50 ms
// (a cadência do tick real). Nenhum timer de verdade e nenhum Math.random (a IA usa
// um LCG semeado por bot), então cada teste reproduz exatamente a mesma partida.
//
// Os testes existem nos TRÊS mapas do Online (layouts 1, 4 e 5): os dados de
// navegação são gerados por mapa, e um erro de extração costuma aparecer só em um.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../room.js';
import { navFor } from '../nav.js';
import { AI, initBotAI, updateBotAI } from '../botAI.js';
import { isOccluded, OCCLUDERS_BY_LAYOUT } from '../../src/net/occluders.js';
import { MAX_CHAMELEONS, GROUND_Y } from '../../src/net/protocol.js';

const LAYOUTS = [1, 4, 5];
const FAKE_WS = { readyState: 0, OPEN: 1 }; // `_send` ignora socket que não está OPEN
const T0 = 1_000_000;

// Sala sem timers, com um Caçador falso e as IAs já criadas (partida começada em T0).
function setup(layout, { hunter = true } = {}) {
  const room = new Room();
  room._layout = layout;
  room.clients.set('hunter', {
    id: 'hunter', role: 'hunter', connected: true, eliminated: false, ws: FAKE_WS,
    pos: { x: 0, y: GROUND_Y, z: 0 }, yaw: 0,
  });
  room._startMatch(T0);
  const nav = navFor(layout);
  const bots = [...room.bots.values()];
  if (!hunter) room.clients.delete('hunter');
  return { room, nav, bots, hunter: room.clients.get('hunter') };
}

function run(room, t0, seconds, each) {
  let t = t0;
  const steps = Math.round((seconds * 1000) / 50);
  for (let i = 0; i < steps; i++) {
    t += 50;
    room._updateBots(t);
    if (each && each(t) === false) break;
  }
  return t;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// Caçador fora do mapa: longe demais pra ver, ouvir ou entrar em qualquer cálculo da IA.
const FAR_AWAY = (nav) => ({ x: nav.x0 - 60, y: GROUND_Y, z: nav.z0 - 60 });

// ------------------------------------------------------------------ dados
for (const layout of LAYOUTS) {
  test(`layout ${layout}: grade e esconderijos são coerentes`, () => {
    const nav = navFor(layout);
    assert.ok(nav, 'todo layout do Online precisa de dados de navegação');
    assert.ok(nav.spots.length >= 30, `poucos esconderijos: ${nav.spots.length}`);
    const seen = new Set();
    for (const s of nav.spots) {
      assert.ok(s.kind === 'w' || s.kind === 'p');
      assert.ok(s.upper >= 0 && s.upper <= 0xffffff && s.lower >= 0 && s.lower <= 0xffffff, 'cor fora de 24 bits');
      assert.ok(s.approach, `esconderijo ${s.index} sem célula de aproximação`);
      const c = nav.center(s.approach.c, s.approach.r);
      assert.ok(dist(c, s) <= 1.0, `aproximação a ${dist(c, s).toFixed(2)}m do esconderijo ${s.index}`);
      if (s.kind === 'p') assert.ok(nav.isFreePoint(s.x, s.z), 'tapete num lugar bloqueado');
      const key = `${s.x},${s.z}`;
      assert.ok(!seen.has(key), 'esconderijo duplicado');
      seen.add(key);
    }
  });

  test(`layout ${layout}: não há ilhotas — toda célula livre é alcançável e todo esconderijo também`, () => {
    const nav = navFor(layout);
    const first = nav.spots[0].approach;
    const flood = nav.flood(first);
    let free = 0, reached = 0;
    for (let r = 0; r < nav.rows; r++) {
      for (let c = 0; c < nav.cols; c++) {
        if (!nav.isFreeCell(c, r)) continue;
        free++;
        if (Number.isFinite(flood.dist[nav.idx(c, r)])) reached++;
      }
    }
    assert.equal(reached, free, `${free - reached} células livres inalcançáveis`);
    for (const s of nav.spots) assert.ok(Number.isFinite(flood.dist[nav.idx(s.approach.c, s.approach.r)]));
  });

  test(`layout ${layout}: caminhos ficam em células livres, contornam parede e são simplificados`, () => {
    const nav = navFor(layout);
    let detours = 0;
    for (let i = 0; i < 25; i++) {
      const a = nav.spots[(i * 7) % nav.spots.length];
      const b = nav.spots[(i * 13 + 5) % nav.spots.length];
      if (a === b) continue;
      const flood = nav.flood(a.approach);
      const cells = nav.pathTo(flood, b.approach);
      assert.ok(cells, 'sem caminho entre dois esconderijos');
      for (const p of cells) assert.ok(nav.isFreePoint(p.x, p.z), 'caminho pisa em célula bloqueada');
      const path = nav.simplify(cells);
      assert.ok(path.length <= cells.length);
      assert.deepEqual(path[0], cells[0]);
      assert.deepEqual(path[path.length - 1], cells[cells.length - 1]);
      for (let k = 1; k < path.length; k++) {
        assert.ok(nav.lineFree(path[k - 1].x, path[k - 1].z, path[k].x, path[k].z), 'trecho simplificado atravessa obstáculo');
      }
      const straight = dist(a.approach && nav.center(a.approach.c, a.approach.r), nav.center(b.approach.c, b.approach.r));
      const length = path.slice(1).reduce((sum, p, k) => sum + dist(path[k], p), 0);
      assert.ok(length >= straight - 1e-6);
      if (length > straight * 1.3 + 0.5) detours++;
    }
    assert.ok(detours > 0, 'nenhum caminho precisou contornar parede — a grade não está bloqueando nada?');
  });
}

test('lineFree recusa atravessar uma parede entre duas células livres', () => {
  const nav = navFor(1);
  // Acha, numa linha da grade, "livre, bloqueado..., livre": o segmento entre os dois
  // livres cruza obstáculo e precisa ser recusado.
  let found = false;
  for (let r = 0; r < nav.rows && !found; r++) {
    let left = -1;
    for (let c = 0; c < nav.cols && !found; c++) {
      if (nav.isFreeCell(c, r)) {
        if (left >= 0 && c - left > 1) {
          const a = nav.center(left, r), b = nav.center(c, r);
          assert.equal(nav.lineFree(a.x, a.z, b.x, b.z), false);
          found = true;
        }
        left = c;
      }
    }
  }
  assert.ok(found, 'não achei nenhuma parede entre células livres na linha da grade');
});

// ------------------------------------------------------------ comportamento
for (const layout of LAYOUTS) {
  test(`layout ${layout}: cada IA chega a um esconderijo real, para e copia a cor da superfície`, () => {
    const { room, bots } = setup(layout, { hunter: false });
    const hidden = new Map();
    run(room, T0, 120, () => {
      for (const b of bots) {
        if (b._ai.state === 'hiding' && !hidden.has(b.id)) {
          hidden.set(b.id, { spot: b._ai.spot, bot: JSON.parse(JSON.stringify(b)) });
        }
      }
    });
    assert.equal(hidden.size, MAX_CHAMELEONS, 'toda IA devia ter chegado a um esconderijo em 2 min');
    for (const { spot, bot } of hidden.values()) {
      assert.equal(bot.moving, false);
      assert.equal(bot.statue, true);
      assert.deepEqual(bot.pos, { x: spot.x, y: GROUND_Y, z: spot.z }, 'para no ponto exato do esconderijo');
      assert.deepEqual(bot.color, [spot.upper, spot.lower], 'copia a cor que o jogo mede ali');
      if (spot.kind === 'w') { assert.equal(bot.state, 'latched'); assert.equal(bot.prone, false); }
      else { assert.equal(bot.state, 'grounded'); assert.equal(bot.prone, true); }
    }
  });

  test(`layout ${layout}: a IA nunca atravessa parede, móvel, escada ou buraco`, () => {
    const { room, nav, bots } = setup(layout, { hunter: false });
    const prev = new Map(bots.map((b) => [b.id, { ...b.pos }]));
    const origin = new Map(bots.map((b) => [b.id, { ...b.pos }]));
    let steps = 0, violations = 0;
    run(room, T0, 240, () => {
      for (const b of bots) {
        const p0 = prev.get(b.id), p1 = b.pos;
        if (b._ai.state === 'hiding') origin.set(b.id, { x: p1.x, z: p1.z });
        if (dist(p0, p1) > 1e-6) {
          steps++;
          if (!nav.lineFree(p0.x, p0.z, p1.x, p1.z)) {
            // Só é aceitável nas pontas: sair do esconderijo (faixa bloqueada junto à
            // parede) ou entrar no próximo. Qualquer outro trecho fora da grade livre é
            // atravessar obstáculo.
            const leaving = dist(p0, origin.get(b.id)) <= 1.1;
            const arriving = b._ai.spot && dist(p1, b._ai.spot) <= 1.1;
            if (!leaving && !arriving) violations++;
          }
        }
        prev.set(b.id, { x: p1.x, z: p1.z });
      }
    });
    assert.ok(steps > 1000, `as IAs mal se moveram (${steps} passos)`);
    assert.equal(violations, 0, `${violations} passos atravessaram obstáculo`);
  });

  test(`layout ${layout}: duas IAs nunca disputam o mesmo esconderijo`, () => {
    const { room, bots } = setup(layout, { hunter: false });
    let checks = 0;
    run(room, T0, 240, () => {
      const used = bots.filter((b) => b._ai.spot).map((b) => b._ai.spot.index);
      assert.equal(new Set(used).size, used.length, 'dois bots com o mesmo destino');
      const hiding = bots.filter((b) => b._ai.state === 'hiding');
      for (let i = 0; i < hiding.length; i++) {
        for (let j = i + 1; j < hiding.length; j++) assert.ok(dist(hiding[i].pos, hiding[j].pos) >= 1.0, 'duas IAs escondidas no mesmo lugar');
      }
      checks++;
    });
    assert.ok(checks > 1000);
  });

  test(`layout ${layout}: sem ameaça a IA fica escondida pelo tempo mínimo e depois troca de lugar`, () => {
    const { room, bots } = setup(layout, { hunter: false });
    const bot = bots[0];
    let hiddenAt = 0, relocatedAfter = 0;
    run(room, T0, 120, (t) => {
      if (!hiddenAt && bot._ai.state === 'hiding') hiddenAt = t;
      if (hiddenAt && !relocatedAfter && bot._ai.state !== 'hiding') relocatedAfter = t - hiddenAt;
    });
    assert.ok(hiddenAt, 'nunca se escondeu');
    assert.ok(relocatedAfter >= AI.HIDE_MS[0] - 1, `trocou de lugar cedo demais (${relocatedAfter}ms)`);
    assert.ok(relocatedAfter <= AI.HIDE_MS[1] + 1000, `ficou parada tempo demais (${relocatedAfter}ms)`);
    assert.equal(bot._ai.recoveries, 0, 'não devia ter travado');
  });

  test(`layout ${layout}: Caçador chegando perto faz a IA reagir e fugir pra longe de onde o viu`, () => {
    const { room, nav, bots, hunter } = setup(layout);
    hunter.pos = FAR_AWAY(nav);
    const bot = bots[0];
    let t = run(room, T0, 120, () => bot._ai.state !== 'hiding');
    assert.equal(bot._ai.state, 'hiding', 'devia ter chegado a um esconderijo');
    // O Caçador aparece a 2m — dentro do alcance de audição (3m), sem depender de linha de visão.
    const at = { x: bot.pos.x + Math.sin(bot._ai.gaze) * 2, z: bot.pos.z + Math.cos(bot._ai.gaze) * 2 };
    hunter.pos = { x: at.x, y: GROUND_Y, z: at.z };
    const spotBefore = bot._ai.spot;
    let alertAt = 0, fleeAt = 0;
    t = run(room, t, 3, (now) => {
      if (!alertAt && bot._ai.state === 'alert') alertAt = now;
      if (!fleeAt && bot._ai.state === 'fleeing') { fleeAt = now; return false; }
    });
    assert.ok(alertAt, 'a IA devia ter entrado em alerta');
    assert.ok(fleeAt, 'a IA devia ter fugido');
    assert.ok(fleeAt - alertAt >= AI.REACTION_MS[0] - 60, `reagiu rápido demais: ${fleeAt - alertAt}ms`);
    assert.ok(fleeAt - alertAt <= AI.REACTION_MS[1] + 120, `reagiu devagar demais: ${fleeAt - alertAt}ms`);
    assert.equal(bot.moving, true);
    assert.equal(bot.state, 'grounded', 'saiu da pose de esconderijo');
    assert.equal(bot.statue, false);

    // Chega ao abrigo novo: diferente do anterior e longe de onde viu o Caçador.
    const from = { x: hunter.pos.x, z: hunter.pos.z };
    t = run(room, t, 90, () => bot._ai.state !== 'hiding');
    assert.equal(bot._ai.state, 'hiding', 'devia ter chegado ao novo esconderijo');
    assert.notEqual(bot._ai.spot.index, spotBefore.index);
    assert.ok(dist(bot._ai.spot, from) >= AI.FLEE_MIN_DIST, `novo esconderijo a só ${dist(bot._ai.spot, from).toFixed(1)}m do Caçador`);
  });
}

test('percepção: parede entre a IA e o Caçador impede o susto mesmo com ele à frente e perto', () => {
  const layout = 1;
  const nav = navFor(layout);
  const boxes = OCCLUDERS_BY_LAYOUT[layout];
  // Acha um ponto P e uma direção θ tais que o ponto Q a 5m de P em θ é livre e tem
  // parede no meio (mesma checagem que a IA faz) — Q fica À FRENTE da IA (dentro do campo
  // de visão) e dentro do alcance de susto (6,5m), fora do alcance de audição (3m). Só a
  // parede pode impedir o susto. (Um Caçador ATRÁS da IA não provaria nada: estaria fora
  // do campo de visão de qualquer jeito.)
  let found = null;
  for (let r = 0; r < nav.rows && !found; r += 3) {
    for (let c = 0; c < nav.cols && !found; c += 3) {
      if (!nav.isFreeCell(c, r)) continue;
      const p = nav.center(c, r);
      for (let k = 0; k < 16 && !found; k++) {
        const theta = (k / 16) * Math.PI * 2;
        const q = { x: p.x + Math.sin(theta) * 5, z: p.z + Math.cos(theta) * 5 };
        if (nav.isFreePoint(q.x, q.z) &&
            isOccluded({ x: p.x, y: GROUND_Y, z: p.z }, { x: q.x, y: GROUND_Y, z: q.z }, boxes)) {
          found = { p, q, theta };
        }
      }
    }
  }
  assert.ok(found, 'não achei um par IA/Caçador com parede no meio');

  const bot = {
    id: 'b', pos: { x: found.p.x, y: GROUND_Y, z: found.p.z }, yaw: 0, eliminated: false, _rng: 7,
    state: 'grounded', prone: false, statue: false, moving: false, color: [0, 0],
  };
  initBotAI(bot, T0);
  bot._ai.state = 'hiding'; bot._ai.hideUntil = Infinity; bot._ai.gaze = found.theta;
  const world = {
    nav, boxes, reserved: new Map(), botIds: new Set(['b']),
    hunter: { pos: { x: found.q.x, y: GROUND_Y, z: found.q.z } },
  };
  updateBotAI(bot, world, T0 + 50);
  assert.equal(bot._ai.state, 'hiding', 'a parede devia esconder o Caçador');

  // Controle: o MESMO Caçador à mesma distância, sem a parede, assusta (senão o teste
  // acima passaria por qualquer motivo, inclusive um bug que ignora o Caçador).
  world.boxes = [];
  updateBotAI(bot, world, T0 + 100);
  assert.equal(bot._ai.state, 'alert', 'sem parede, o Caçador à frente e perto devia assustar');
});

test('percepção: campo de visão — de frente assusta, de costas (sem som) não', () => {
  const layout = 5;
  const nav = navFor(layout);
  const boxes = OCCLUDERS_BY_LAYOUT[layout];
  // IA sintética num ponto aberto do salão, olhando pro "norte" (gaze 0 → +Z).
  const bot = {
    id: 'b', pos: { x: 0, y: GROUND_Y, z: 0 }, yaw: 0, eliminated: false, _rng: 7,
    state: 'grounded', prone: false, statue: false, moving: false, color: [0, 0],
  };
  assert.ok(nav.isFreePoint(0, 0));
  initBotAI(bot, T0);
  const build = (dx, dz) => ({
    nav, boxes, reserved: new Map(), botIds: new Set(['b']),
    hunter: { pos: { x: dx, y: GROUND_Y, z: dz } },
  });
  const probe = (dx, dz) => {
    bot._ai.state = 'hiding'; bot._ai.hideUntil = Infinity; bot._ai.gaze = 0; bot._ai.memory = null;
    updateBotAI(bot, build(dx, dz), T0 + 50);
    return bot._ai.state;
  };
  assert.ok(!isOccluded(bot.pos, { x: 0, y: GROUND_Y, z: 5 }, boxes) && !isOccluded(bot.pos, { x: 0, y: GROUND_Y, z: -5 }, boxes), 'ponto de teste tem que ter linha de visão livre');
  assert.equal(probe(0, 5), 'alert', 'Caçador visível à frente, a 5m, devia assustar');
  assert.equal(probe(0, -5), 'hiding', 'Caçador atrás, a 5m, fora do campo de visão e do alcance de audição, não devia assustar');
  assert.equal(probe(0, -2.5), 'alert', 'mas dentro do alcance de audição (3m) até de costas assusta');
  assert.equal(probe(0, -3.6), 'hiding', 'e logo além do alcance de audição, de costas, não');
  assert.equal(probe(0, 8), 'hiding', 'visto mas longe (além do alcance de susto) não assusta');
});

test('percepção: o som atravessa parede — Caçador colado do outro lado assusta mesmo sem linha de visão', () => {
  const layout = 1;
  const nav = navFor(layout);
  const boxes = OCCLUDERS_BY_LAYOUT[layout];
  // Par P/Q a 2,5m (dentro do alcance de audição, 3m) com parede no meio.
  let found = null;
  for (let r = 0; r < nav.rows && !found; r += 2) {
    for (let c = 0; c < nav.cols && !found; c += 2) {
      if (!nav.isFreeCell(c, r)) continue;
      const p = nav.center(c, r);
      for (let k = 0; k < 16 && !found; k++) {
        const theta = (k / 16) * Math.PI * 2;
        const q = { x: p.x + Math.sin(theta) * 2.5, z: p.z + Math.cos(theta) * 2.5 };
        if (nav.isFreePoint(q.x, q.z) &&
            isOccluded({ x: p.x, y: GROUND_Y, z: p.z }, { x: q.x, y: GROUND_Y, z: q.z }, boxes)) found = { p, q, theta };
      }
    }
  }
  assert.ok(found, 'não achei um par a 2,5m com parede no meio');
  const bot = {
    id: 'b', pos: { x: found.p.x, y: GROUND_Y, z: found.p.z }, yaw: 0, eliminated: false, _rng: 7,
    state: 'grounded', prone: false, statue: false, moving: false, color: [0, 0],
  };
  initBotAI(bot, T0);
  bot._ai.state = 'hiding'; bot._ai.hideUntil = Infinity; bot._ai.gaze = found.theta + Math.PI; // de costas pro Caçador
  updateBotAI(bot, {
    nav, boxes, reserved: new Map(), botIds: new Set(['b']),
    hunter: { pos: { x: found.q.x, y: GROUND_Y, z: found.q.z } },
  }, T0 + 50);
  assert.equal(bot._ai.state, 'alert');
});

test('fuga: o novo esconderijo nunca fica a menos de FLEE_MIN_DIST de onde a IA viu o Caçador (40 sementes)', () => {
  const layout = 1;
  const nav = navFor(layout);
  const boxes = OCCLUDERS_BY_LAYOUT[layout];
  assert.ok(nav.isFreePoint(0, 0));
  let chosenCount = 0;
  for (let seed = 0; seed < 40; seed++) {
    const bot = {
      id: 'b', pos: { x: 0, y: GROUND_Y, z: 0 }, yaw: 0, eliminated: false, _rng: seed * 7919 + 1,
      state: 'grounded', prone: false, statue: false, moving: false, color: [0, 0],
    };
    initBotAI(bot, T0);
    const hunter = { pos: { x: 2, y: GROUND_Y, z: 0 } }; // a 2m: dentro do alcance de audição
    bot._ai.state = 'alert'; bot._ai.reactAt = T0; bot._ai.gaze = Math.PI / 2;
    updateBotAI(bot, { nav, boxes, reserved: new Map(), botIds: new Set(['b']), hunter }, T0 + 50);
    assert.equal(bot._ai.state, 'fleeing', `semente ${seed}: devia ter fugido`);
    chosenCount++;
    const d = dist(bot._ai.spot, hunter.pos);
    assert.ok(d >= AI.FLEE_MIN_DIST, `semente ${seed}: fugiu pra um esconderijo a ${d.toFixed(1)}m do Caçador`);
  }
  assert.equal(chosenCount, 40);
});

test('fuga: a distância mínima é regra dura — vale mesmo quando o esconderijo perto do Caçador seria o mais tentador', () => {
  // Num mapa cheio de opções a pontuação já afasta a IA do Caçador, então a regra nunca
  // "morde". Aqui só há DUAS opções: uma colada no Caçador (mas NÃO atrás dele — senão a
  // regra de "não passar pelo Caçador" a descartaria e mascararia esta) e uma a ~80m de
  // caminho. Sem a regra, a IA escolheria a colada na maioria das sementes.
  const layout = 5;
  const nav = navFor(layout);
  const boxes = OCCLUDERS_BY_LAYOUT[layout];
  const botPos = { x: 0, z: 0 };
  const hunterPos = { x: 2, z: 0 };
  const flood = nav.flood(nav.nearestFree(botPos.x, botPos.z, 6));
  const pathDist = (s) => flood.dist[nav.idx(s.approach.c, s.approach.r)];

  const near = nav.spots.find((s) => {
    const dh = dist(s, hunterPos);
    if (!(dh >= 3.5 && dh <= 5.5) || !Number.isFinite(pathDist(s))) return false;
    const toSpot = { x: s.x - botPos.x, z: s.z - botPos.z };
    const cos = (toSpot.x * hunterPos.x + toSpot.z * hunterPos.z) / ((Math.hypot(toSpot.x, toSpot.z) || 1) * Math.hypot(hunterPos.x, hunterPos.z));
    return cos <= 0.3; // do lado/oposto ao Caçador, fora da regra "atrás dele"
  });
  const far = nav.spots.reduce((a, s) => (Number.isFinite(pathDist(s)) && pathDist(s) > (a ? pathDist(a) : -1) ? s : a), null);
  assert.ok(near && far && far !== near, 'cenário de teste não montou');
  assert.ok(pathDist(far) > 60, `o esconderijo distante devia estar a mais de 60m (está a ${pathDist(far).toFixed(0)}m)`);

  const scarce = Object.create(nav);
  scarce.spots = [near, far];
  for (let seed = 0; seed < 40; seed++) {
    const bot = {
      id: 'b', pos: { x: botPos.x, y: GROUND_Y, z: botPos.z }, yaw: 0, eliminated: false, _rng: seed * 7919 + 1,
      state: 'grounded', prone: false, statue: false, moving: false, color: [0, 0],
    };
    initBotAI(bot, T0);
    bot._ai.state = 'alert'; bot._ai.reactAt = T0; bot._ai.gaze = Math.PI / 2;
    updateBotAI(bot, {
      nav: scarce, boxes, reserved: new Map(), botIds: new Set(['b']),
      hunter: { pos: { x: hunterPos.x, y: GROUND_Y, z: hunterPos.z } },
    }, T0 + 50);
    assert.equal(bot._ai.state, 'fleeing', `semente ${seed}: devia ter fugido`);
    assert.equal(bot._ai.spot.index, far.index, `semente ${seed}: escolheu o esconderijo a ${dist(near, hunterPos).toFixed(1)}m do Caçador`);
  }
});

test('em movimento e dando de cara com o Caçador: a IA passa a fugir sem esperar reação', () => {
  const { room, nav, bots, hunter } = setup(1);
  hunter.pos = FAR_AWAY(nav);
  const bot = bots[0];
  let t = run(room, T0, 120, () => bot._ai.state !== 'hiding');
  // Espera a troca de lugar (volta a andar) e põe o Caçador colado nela.
  t = run(room, t, 60, () => bot._ai.state === 'hiding');
  assert.equal(bot._ai.state, 'moving');
  hunter.pos = { x: bot.pos.x + 1.5, y: GROUND_Y, z: bot.pos.z };
  run(room, t, 0.5, () => {});
  assert.equal(bot._ai.state, 'fleeing');
});

test('IA travada (sem progresso) desiste do destino e escolhe outro', () => {
  const { room, bots } = setup(1, { hunter: false });
  const bot = bots[0];
  let t = run(room, T0, 2, () => bot._ai.state === 'moving' ? false : true);
  assert.equal(bot._ai.state, 'moving');
  const stuckAt = { ...bot.pos };
  const stuckSpot = bot._ai.spot.index;
  // Um obstáculo invisível que a grade não conhece: a posição não sai do lugar.
  t = run(room, t, 6, () => { bot.pos = { ...stuckAt }; if (bot._ai.recoveries > 0) return false; });
  assert.ok(bot._ai.recoveries >= 1, 'devia ter detectado que travou');
  assert.ok(bot._ai.badSpots.has(stuckSpot), 'o destino que travou não pode ser escolhido de novo');
  run(room, t, 60, () => bot._ai.state !== 'hiding');
  assert.equal(bot._ai.state, 'hiding', 'depois de travar, devia seguir pra outro esconderijo');
  assert.notEqual(bot._ai.spot.index, stuckSpot);
});

test('IA eliminada não se mexe', () => {
  const { room, bots } = setup(1, { hunter: false });
  const bot = bots[0];
  bot.eliminated = true;
  const before = { ...bot.pos };
  run(room, T0, 30, () => {});
  assert.deepEqual(bot.pos, before);
  assert.equal(bot.moving, false);
});

test('vaga assumida por IA (humano saiu de uma parede) começa andando e se esconde em outro lugar', () => {
  const { room, nav, bots } = setup(1, { hunter: false });
  const wall = nav.spots.find((s) => s.kind === 'w');
  const leaving = { id: 'gone', eliminated: false, color: [0x123456, 0x123456], pos: { x: wall.x, y: GROUND_Y, z: wall.z } };
  for (const b of bots) room.bots.delete(b.id);
  room._fillBotSlots(T0, leaving);
  const replacement = [...room.bots.values()][0];
  assert.deepEqual(replacement.pos, leaving.pos, 'nasce onde o humano estava');
  assert.deepEqual(replacement.color, leaving.color, 'e com a cor dele');
  run(room, T0, 90, () => replacement._ai.state !== 'hiding');
  assert.equal(replacement._ai.state, 'hiding');
  assert.ok(dist(replacement.pos, { x: wall.x, z: wall.z }) > 0.5 || replacement._ai.spot.index !== wall.index);
});

// ------------------------------------------------------- robustez e desempenho
for (const layout of LAYOUTS) {
  test(`layout ${layout}: mesma semente, mesma partida (nenhum Math.random escondido)`, () => {
    const trace = () => {
      const { room, bots } = setup(layout, { hunter: false });
      run(room, T0, 90, () => {});
      return bots.map((b) => [b.pos.x, b.pos.z, b._ai.state, b._ai.lastSpot]);
    };
    assert.deepEqual(trace(), trace());
  });
}

test('desempenho: 4 IAs no maior mapa por 2 min simulados custam pouco por tick', (t) => {
  const { room } = setup(5);
  let worst = 0, total = 0, clock = T0;
  const ticks = 2400; // 2 min a 20 Hz
  for (let i = 0; i < ticks; i++) {
    clock += 50;
    const start = performance.now();
    room._updateBots(clock);
    const took = performance.now() - start;
    worst = Math.max(worst, took);
    total += took;
  }
  const avg = total / ticks;
  t.diagnostic("tick médio " + avg.toFixed(3) + "ms, pior " + worst.toFixed(1) + "ms (tick real = 50ms)");
  assert.ok(avg < 3, `média de ${avg.toFixed(2)}ms por tick é alta demais (o tick real é de 50ms)`);
  assert.ok(worst < 40, `pior tick: ${worst.toFixed(1)}ms`);
});
