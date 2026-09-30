// Validação de velocidade do servidor (room.js:_validateMove).
//
// O que se protege: um cliente adulterado andar mais rápido que o jogo permite ou
// "teletransportar" (chegar ao Camaleão, ou sair da linha de tiro). O que NÃO pode
// acontecer: corrigir a posição de quem joga honestamente — por isso metade dos
// testes abaixo são de movimento LEGÍTIMO que tem de passar (corrida máxima, pacotes
// agrupados pela rede, queda livre, ressincronização depois de reconexão).
//
// Os limites vêm do Player.js real (ver comentário em room.js) e os testes usam os
// mesmos números do jogo, não valores escolhidos pra passar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, connectClient, send, closeClient } from '../testHelpers.mjs';

const BURST = 0.75; // segundos de crédito acumulável (MOVE_BURST_S)

// Cliente de verdade, mas com relógio e créditos controlados pelo teste — assim os
// casos não dependem de esperar tempo real nem do jitter da máquina.
async function moveFixture() {
  const server = await startTestServer();
  const { ws, welcome } = await connectClient(server.url);
  const client = server.room.clients.get(welcome.id);
  const T0 = 1_000_000;
  client.pos = { x: 0, y: 0.72, z: 0 };
  client._moveAt = T0;
  client._creditXZ = 10.5 * BURST;
  client._creditUp = 8 * BURST;
  client._creditDown = 26 * BURST;
  client._teleportGraceUntil = 0;
  client._resync = false;
  client.speedViolations = 0;
  const step = (dx, dy, dz, t) => {
    const out = server.room._validateMove(client, { x: client.pos.x + dx, y: client.pos.y + dy, z: client.pos.z + dz }, t);
    if (out) client.pos = out;
    return out;
  };
  return { server, client, T0, step, stop: async () => { await closeClient(ws); await server.stop(); } };
}

test('corrida legítima na velocidade máxima do jogo nunca é corrigida', async () => {
  const f = await moveFixture();
  try {
    for (let i = 1; i <= 200; i++) f.step(8.25 * 0.05, 0, 0, f.T0 + i * 50);
    assert.equal(f.client.speedViolations, 0);
    assert.ok(Math.abs(f.client.pos.x - 8.25 * 0.05 * 200) < 1e-6, 'posição acompanha o cliente exatamente');
  } finally { await f.stop(); }
});

test('pacotes agrupados pela rede (latência) não geram falso positivo', async () => {
  const f = await moveFixture();
  try {
    // 10 pacotes no MESMO milissegundo, cada um com um passo legítimo de 0,41m.
    for (let i = 0; i < 10; i++) f.step(0.4125, 0, 0, f.T0 + 50);
    assert.equal(f.client.speedViolations, 0);
    assert.ok(Math.abs(f.client.pos.x - 4.125) < 1e-6);
  } finally { await f.stop(); }
});

test('3x a velocidade é travado no limite sustentado e contado', async () => {
  const f = await moveFixture();
  try {
    // 4s a 3 × 8,25 m/s (24,75 m/s). Teto: 10,5 m/s × 4s + a rajada inicial.
    for (let i = 1; i <= 80; i++) f.step(8.25 * 3 * 0.05, 0, 0, f.T0 + i * 50);
    const reachable = 10.5 * 4 + 10.5 * BURST;
    assert.ok(f.client.pos.x <= reachable + 1e-6, `avançou ${f.client.pos.x}m, teto ${reachable}m`);
    assert.ok(f.client.pos.x > reachable - 2, 'mas anda, no limite — nunca congela');
    assert.ok(f.client.speedViolations > 0);
    assert.ok(f.client.pos.x < 99 / 1.5, 'fica bem atrás dos ~99m que o cliente diz ter andado');
  } finally { await f.stop(); }
});

test('teleporte de 50m num único pacote anda só o crédito de rajada', async () => {
  const f = await moveFixture();
  try {
    f.step(50, 0, 0, f.T0 + 50);
    assert.ok(f.client.pos.x <= 10.5 * BURST + 10.5 * 0.05 + 1e-6);
    assert.equal(f.client.speedViolations, 1);
  } finally { await f.stop(); }
});

test('depois de um teleporte do servidor, entradas em trânsito são descartadas sem punir', async () => {
  const f = await moveFixture();
  try {
    const spawn = { x: 3, y: 0.72, z: 4 };
    f.server.room._teleport(f.client, spawn, f.T0);
    // Entrada enviada ANTES de o cliente saber do reset: posição antiga, 60m de distância.
    const out = f.step(60, 0, 0, f.T0 + 100);
    assert.equal(out, null);
    assert.deepEqual(f.client.pos, spawn);
    assert.equal(f.client.speedViolations, 0);
    // Um passo normal a partir do spawn novo é aceito dentro da própria janela de graça.
    assert.ok(f.step(0.4, 0, 0, f.T0 + 150));
    // Passada a janela, o mesmo salto volta a ser corrigido e contado.
    f.step(60, 0, 0, f.T0 + 1200);
    assert.equal(f.client.speedViolations, 1);
  } finally { await f.stop(); }
});

test('reconexão ressincroniza uma vez, pelo tempo real da queda', async () => {
  const f = await moveFixture();
  try {
    f.client._resync = true; // como _reattach deixa
    // 10s fora: dá pra ter corrido 105m — um salto de 80m é legítimo.
    assert.ok(f.step(80, 0, 0, f.T0 + 10_000));
    assert.equal(f.client.speedViolations, 0);
    assert.ok(Math.abs(f.client.pos.x - 80) < 1e-6);
    // Mas é UMA vez: o crédito volta ao teto de rajada logo em seguida.
    f.step(50, 0, 0, f.T0 + 10_050);
    assert.equal(f.client.speedViolations, 1);
    assert.ok(f.client.pos.x < 80 + 10.5 * BURST + 1);
  } finally { await f.stop(); }
});

test('queda livre do ático passa, subida rápida demais não', async () => {
  const f = await moveFixture();
  try {
    // Queda a 22 m/s (GRAVITY=22, ~11m de altura) por 0,5s.
    for (let i = 1; i <= 10; i++) f.step(0, -22 * 0.05, 0, f.T0 + i * 50);
    assert.equal(f.client.speedViolations, 0, 'queda legítima não pode ser corrigida');
    assert.ok(Math.abs(f.client.pos.y - (0.72 - 11)) < 1e-6);

    // Subir a 20 m/s (voo/teleporte vertical) por 2s: teto = 8 m/s + rajada.
    const startY = f.client.pos.y;
    for (let i = 1; i <= 40; i++) f.step(0, 20 * 0.05, 0, f.T0 + 500 + i * 50);
    assert.ok(f.client.pos.y - startY <= 8 * 2 + 8 * BURST + 1e-6);
    assert.ok(f.client.speedViolations > 0);
  } finally { await f.stop(); }
});

test('ponta a ponta: INPUT com salto de 60m chega encurtado ao servidor', async () => {
  const server = await startTestServer();
  try {
    const { ws, welcome } = await connectClient(server.url);
    const state = server.room.clients.get(welcome.id);
    const start = { ...state.pos };

    send(ws, { type: 'input', p: [start.x + 60, start.y, start.z], y: 0, s: 'grounded', c: 0, r: 0, k: 0, m: 1 });
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(state.pos.x - start.x < 10, `posição ${state.pos.x - start.x}m à frente; devia estar encurtada`);
    assert.ok(state.pos.x - start.x > 0, 'mas o jogador anda até onde é permitido');
    assert.equal(state.speedViolations, 1);

    // E um passo pequeno e legítimo logo depois continua sendo aceito.
    const before = state.pos.x;
    send(ws, { type: 'input', p: [before + 0.3, start.y, start.z], y: 0, s: 'grounded', c: 0, r: 0, k: 0, m: 1 });
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(Math.abs(state.pos.x - (before + 0.3)) < 1e-6);
    await closeClient(ws);
  } finally {
    await server.stop();
  }
});
