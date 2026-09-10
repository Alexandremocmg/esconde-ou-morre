// Cobertura da lógica de sala (server/room.js) contra o comportamento REAL de rede
// (ver testHelpers.mjs pra por que não mockamos `ws`). Cobre os invariantes que já
// mudaram nesta sessão (capacidade do lobby, revive sem reconectar, validação de
// pincel) e que quebrariam silenciosamente num refactor futuro sem isto.
//
// Cuidado ao ler/escrever testes aqui: a sala transmite SNAPSHOT pra todo mundo a
// 20Hz o tempo todo que há gente conectada — "a próxima mensagem que chegar" quase
// nunca é uma garantia válida. Use `connectClient` (já espera o WELCOME certo) e
// `waitForMessage(ws, predicate)` (ignora SNAPSHOTs até achar o tipo esperado) em
// vez de `nextMessage` cru pra qualquer coisa que não seja "a primeiríssima
// mensagem depois de abrir a conexão".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CHAMELEONS } from '../../src/net/protocol.js';
import { startTestServer, connectClient, rawConnect, waitForMessage, send, closeClient } from '../testHelpers.mjs';

const ROOM_CAPACITY = 1 + MAX_CHAMELEONS;

test('1º a entrar vira Caçador, os próximos viram Camaleão, até a capacidade da sala', async () => {
  const server = await startTestServer();
  try {
    const clients = [];
    for (let i = 0; i < ROOM_CAPACITY; i++) {
      const c = await connectClient(server.url);
      clients.push(c);
    }
    assert.equal(clients[0].welcome.role, 'hunter');
    for (let i = 1; i < ROOM_CAPACITY; i++) {
      assert.equal(clients[i].welcome.role, 'chameleon', `cliente ${i} devia ser chameleon`);
    }
    for (const c of clients) await closeClient(c.ws);
  } finally {
    await server.stop();
  }
});

test('sala cheia recusa com MATCH_OVER e fecha com código 4001', async () => {
  const server = await startTestServer();
  try {
    const clients = [];
    for (let i = 0; i < ROOM_CAPACITY; i++) clients.push(await connectClient(server.url));

    const extraWs = await rawConnect(server.url);
    const msg = await waitForMessage(extraWs, (m) => m.type === 'matchOver', 1000);
    assert.ok(msg, 'esperava um MATCH_OVER pra conexão além da capacidade');
    assert.equal(msg.winner, null);

    const closeCode = await new Promise((resolve) => extraWs.once('close', (code) => resolve(code)));
    assert.equal(closeCode, 4001);

    for (const c of clients) await closeClient(c.ws);
  } finally {
    await server.stop();
  }
});

test('revive reabre a partida (zera eliminated/_over) sem precisar reconectar', async () => {
  const server = await startTestServer();
  try {
    const hunter = await connectClient(server.url);
    const chameleon = await connectClient(server.url);

    // Simula fim de partida direto no estado da sala (sem depender de tiro/timer
    // real aqui — isso já é coberto pelos testes de hardening/protocolo).
    server.room._endMatch('hunter', 'teste');
    const c = server.room.clients.get(chameleon.welcome.id);
    c.eliminated = true;

    assert.equal(server.room._over, true);
    send(chameleon.ws, { type: 'revive' });
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(server.room._over, false);
    assert.equal(c.eliminated, false);

    await closeClient(hunter.ws);
    await closeClient(chameleon.ws);
  } finally {
    await server.stop();
  }
});

test('revive durante a rodada não ressuscita um Camaleão eliminado', async () => {
  const server = await startTestServer();
  try {
    const hunter = await connectClient(server.url);
    const chameleon = await connectClient(server.url);
    const c = server.room.clients.get(chameleon.welcome.id);
    c.eliminated = true;

    send(chameleon.ws, { type: 'revive' });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(server.room._over, false);
    assert.equal(c.eliminated, true);

    await closeClient(hunter.ws);
    await closeClient(chameleon.ws);
  } finally {
    await server.stop();
  }
});

test('JOIN repetido não recarrega munição nem troca munição infinita', async () => {
  const server = await startTestServer();
  try {
    const hunter = await connectClient(server.url);
    const c = server.room.clients.get(hunter.welcome.id);

    send(hunter.ws, { type: 'join', ammo: 12, infiniteAmmo: false });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(c.ammo, 12);
    assert.equal(c.maxAmmo, 12);
    assert.equal(c.infiniteAmmo, false);

    send(hunter.ws, { type: 'join', ammo: 30, infiniteAmmo: true });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(c.ammo, 12);
    assert.equal(c.maxAmmo, 12);
    assert.equal(c.infiniteAmmo, false);

    await closeClient(hunter.ws);
  } finally {
    await server.stop();
  }
});

test('tiro com origem forjada ou vetor inválido não gasta munição', async () => {
  const server = await startTestServer();
  try {
    const hunter = await connectClient(server.url);
    const chameleon = await connectClient(server.url);
    const h = server.room.clients.get(hunter.welcome.id);
    h.joinConfigured = true;
    h.ammo = 8;
    server.room._matchStartAt = Date.now() - 1;

    send(hunter.ws, { type: 'fire', origin: { x: 999, y: 999, z: 999 }, dir: { x: 0, y: 0, z: -1 } });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(h.ammo, 8);

    send(hunter.ws, { type: 'fire', origin: { x: h.pos.x, y: h.pos.y, z: h.pos.z }, dir: { x: NaN, y: 0, z: -1 } });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(h.ammo, 8);

    await closeClient(hunter.ws);
    await closeClient(chameleon.ws);
  } finally {
    await server.stop();
  }
});

test('PAINT: traços inválidos são descartados, válidos são retransmitidos', async () => {
  const server = await startTestServer();
  try {
    const a = await connectClient(server.url); // hunter
    const b = await connectClient(server.url); // chameleon — vai mandar o traço

    const strokes = [
      { d: 1, u: 0.5, v: 0.5, c: '#ff00ff', r: 0.05 },      // válido
      { d: 0, u: 1.5, v: 0.5, c: '#ff00ff', r: 0.05 },      // uv fora de [0,1] — descartado
      { d: 0, u: 0.2, v: 0.2, c: 'not-a-color', r: 0.05 },  // cor inválida — descartado
      { d: 0, u: 0.3, v: 0.3, c: '#00ff00', r: 0.9 },       // raio > 0.5 — descartado
      { d: 0, u: 0.6, v: 0.6, c: '#00ff00', r: 0.02 },      // válido
    ];
    send(b.ws, { type: 'paint', strokes });

    const received = await waitForMessage(a.ws, (m) => m.type === 'playerPaint', 1000);
    assert.ok(received, 'esperava um playerPaint retransmitido');
    assert.equal(received.id, b.welcome.id);
    assert.equal(received.strokes.length, 2, 'só os 2 traços válidos deviam passar');
    assert.equal(received.strokes[0].u, 0.5);
    assert.equal(received.strokes[1].u, 0.6);

    await closeClient(a.ws);
    await closeClient(b.ws);
  } finally {
    await server.stop();
  }
});

test('PAINT: lote maior que MAX_PAINT_STROKES_PER_MSG é rejeitado por completo', async () => {
  const server = await startTestServer();
  try {
    const a = await connectClient(server.url);
    const b = await connectClient(server.url);

    const tooMany = Array.from({ length: 401 }, () => ({ d: 1, u: 0.5, v: 0.5, c: '#ffffff', r: 0.05 }));
    send(b.ws, { type: 'paint', strokes: tooMany });

    // `waitForMessage` devolve `null` no timeout em vez de rejeitar — é o que
    // deixa "nunca chegou um playerPaint" (o esperado aqui) diferente de
    // "chegaram só SNAPSHOTs no meio do caminho" (que `nextMessage` cru
    // confundiria com "alguma coisa chegou").
    const received = await waitForMessage(a.ws, (m) => m.type === 'playerPaint', 300);
    assert.equal(received, null, 'lote acima do limite não devia ser retransmitido');

    await closeClient(a.ws);
    await closeClient(b.ws);
  } finally {
    await server.stop();
  }
});

test('reconexão (?rejoin=id:token) devolve o MESMO id/role, não um cliente novo', async () => {
  const server = await startTestServer();
  try {
    const first = await connectClient(server.url);
    const { id, token, role } = first.welcome;

    await closeClient(first.ws);
    await new Promise((r) => setTimeout(r, 50)); // dá tempo do 'close' do servidor processar

    const reconnected = await connectClient(server.url, `/?rejoin=${id}:${token}`);
    assert.equal(reconnected.welcome.id, id);
    assert.equal(reconnected.welcome.role, role);

    await closeClient(reconnected.ws);
  } finally {
    await server.stop();
  }
});
