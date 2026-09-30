// Rotação do Caçador entre rodadas (docs/PLANO_MELHORIAS_JOGO.md, etapa 1).
//
// Antes: o papel era fixo para a vida da sala — quem entrava primeiro caçava para
// sempre e os outros nunca saíam de Camaleão. Agora cada revanche passa o papel
// adiante (room.js:_rotateHunter), e o cliente lê o próprio papel do mesmo ROUND_RESET
// que reposiciona todo mundo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CHAMELEONS, RECONNECT_GRACE_MS } from '../../src/net/protocol.js';
import { startTestServer, connectClient, waitForMessage, send, closeClient } from '../testHelpers.mjs';

// Encerra a rodada, todos confirmam a revanche e devolve o ROUND_RESET de cada um.
// `_endMatch` direto (em vez de jogar uma partida inteira) porque o que se testa é a
// transição de rodada, não o tiro/timer — já cobertos em room.test.mjs.
async function rematchAll(server, clients) {
  server.room._endMatch('hunter', 'teste');
  for (const c of clients) send(c.ws, { type: 'revive' });
  return Promise.all(clients.map((c) => waitForMessage(c.ws, (m) => m.type === 'roundReset', 1500)));
}

const roleIn = (resetMsg, id) => resetMsg.players.find((p) => p.id === id).role;

test('com 3 humanos o Caçador passa por todos antes de repetir', async () => {
  const server = await startTestServer();
  try {
    const clients = [];
    for (let i = 0; i < 3; i++) clients.push(await connectClient(server.url));
    const [a, b, c] = clients;
    assert.equal(a.welcome.role, 'hunter');

    const expectedHunters = [b, c, a, b]; // 4 revanches seguidas
    for (const expected of expectedHunters) {
      const resets = await rematchAll(server, clients);
      assert.ok(resets.every(Boolean), 'todos deviam receber o ROUND_RESET');

      // Todo mundo enxerga os MESMOS papéis no pacote — nenhum cliente fica com papel velho.
      for (const client of clients) {
        const seen = resets.map((r) => roleIn(r, client.welcome.id));
        assert.ok(seen.every((r) => r === seen[0]), 'papéis divergentes entre os ROUND_RESET');
      }
      const hunters = clients.filter((x) => roleIn(resets[0], x.welcome.id) === 'hunter');
      assert.equal(hunters.length, 1, 'exatamente um Caçador por rodada');
      assert.equal(hunters[0].welcome.id, expected.welcome.id);

      const state = server.room.clients.get(expected.welcome.id);
      assert.equal(state.role, 'hunter');
      assert.equal(state.ammo, 8, 'novo Caçador começa com a munição cheia');
      assert.deepEqual(state.pos, state.spawn, 'novo Caçador nasce no spawn do Caçador');
    }
    for (const x of clients) await closeClient(x.ws);
  } finally {
    await server.stop();
  }
});

test('Caçador rebaixado vira Camaleão com spawn próprio, sem empilhar ninguém', async () => {
  const server = await startTestServer();
  try {
    const clients = [];
    for (let i = 0; i < 3; i++) clients.push(await connectClient(server.url));
    await rematchAll(server, clients);

    const states = clients.map((x) => server.room.clients.get(x.welcome.id));
    assert.equal(states[0].role, 'chameleon', 'o Caçador da rodada anterior foi rebaixado');
    assert.equal(states.filter((s) => s.role === 'chameleon').length, 2);
    const positions = new Set(states.map((s) => `${s.pos.x.toFixed(2)},${s.pos.z.toFixed(2)}`));
    assert.equal(positions.size, 3, 'ninguém pode nascer em cima de outro');
    for (const s of states) assert.equal(s.eliminated, false);
    for (const x of clients) await closeClient(x.ws);
  } finally {
    await server.stop();
  }
});

test('um humano só (o resto é IA) continua Caçador depois da revanche', async () => {
  const server = await startTestServer();
  try {
    const solo = await connectClient(server.url);
    server.room._matchmakingDeadline = Date.now() - 1;
    server.room._tick();
    assert.equal(server.room.bots.size, MAX_CHAMELEONS);

    const [reset] = await rematchAll(server, [solo]);
    assert.equal(roleIn(reset, solo.welcome.id), 'hunter');
    assert.equal(server.room.bots.size, 0, 'IAs saem na volta à busca por humanos');
    await closeClient(solo.ws);
  } finally {
    await server.stop();
  }
});

test('quem foi promovido por saída do Caçador não caça de novo antes dos outros', async () => {
  const server = await startTestServer();
  try {
    const a = await connectClient(server.url);
    const b = await connectClient(server.url);
    const c = await connectClient(server.url);
    await closeClient(a.ws);
    await new Promise((r) => setTimeout(r, 25));
    server.room.clients.get(a.welcome.id).disconnectedAt = Date.now() - RECONNECT_GRACE_MS - 1;
    server.room._purgeStale(Date.now());
    assert.equal(server.room.clients.get(b.welcome.id).role, 'hunter', 'B entrou antes de C');

    const resets = await rematchAll(server, [b, c]);
    assert.equal(roleIn(resets[0], c.welcome.id), 'hunter', 'C ainda não tinha caçado — é a vez dele');
    assert.equal(roleIn(resets[0], b.welcome.id), 'chameleon');
    await closeClient(b.ws);
    await closeClient(c.ws);
  } finally {
    await server.stop();
  }
});

test('o novo Caçador não herda a posição do papel anterior: reconexão devolve o papel novo', async () => {
  const server = await startTestServer();
  try {
    const a = await connectClient(server.url);
    const b = await connectClient(server.url);
    await rematchAll(server, [a, b]);
    assert.equal(server.room.clients.get(b.welcome.id).role, 'hunter');

    // B cai e volta: o WELCOME de reconexão tem que trazer o papel da rotação, não
    // o que ele tinha ao entrar — é daí que o cliente se corrige depois de um reload.
    await closeClient(b.ws);
    await new Promise((r) => setTimeout(r, 25));
    const again = await connectClient(server.url, `/?rejoin=${b.welcome.id}:${b.welcome.token}`);
    assert.equal(again.welcome.id, b.welcome.id);
    assert.equal(again.welcome.role, 'hunter');
    assert.equal(again.welcome.self.role, 'hunter');
    await closeClient(a.ws);
    await closeClient(again.ws);
  } finally {
    await server.stop();
  }
});
