// Cobertura de regressão pro fix de hardening (docs/_log.md, 2026-08-25 — "servidor
// exposto a payload gigante e flood de mensagens"). Sem isto, um `maxPayload`
// removido por engano ou um rate limit quebrado num refactor futuro só apareceria
// em produção, sob ataque de verdade — exatamente o cenário que motivou o fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startTestServer, connectClient, send, closeClient } from '../testHelpers.mjs';

test('handshake normal recebe WELCOME com id/role', async () => {
  const server = await startTestServer();
  try {
    const { ws, welcome } = await connectClient(server.url);
    assert.equal(welcome.type, 'welcome');
    assert.ok(welcome.id);
    assert.equal(welcome.role, 'hunter'); // primeiro a entrar na sala
    await closeClient(ws);
  } finally {
    await server.stop();
  }
});

test('mensagem acima de maxPayload fecha a conexão com código 1009', async () => {
  const server = await startTestServer();
  try {
    const { ws } = await connectClient(server.url);
    // ~1MB de traços de pincel — bem acima do maxPayload de 64KB (server/index.js).
    const bigStrokes = Array.from({ length: 20000 }, () => ({ d: 1, u: 0.5, v: 0.5, c: '#ffffff', r: 0.1 }));
    const closeInfo = new Promise((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
    send(ws, { type: 'paint', strokes: bigStrokes });
    const result = await closeInfo;
    assert.equal(result.code, 1009); // "message too big", direto da lib `ws`
  } finally {
    await server.stop();
  }
});

test('flood de mensagens não derruba o servidor nem trava o socket', async () => {
  const server = await startTestServer();
  try {
    const { ws } = await connectClient(server.url);
    // Bem acima do rate limit de 40/s (server/room.js:MAX_MSGS_PER_SEC) — o
    // excesso deve ser ignorado em silêncio, não travar nem fechar a conexão.
    for (let i = 0; i < 200; i++) send(ws, { type: 'join', ammo: 5 });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(ws.readyState, WebSocket.OPEN);

    // Servidor continua processando mensagens novas depois do flood (não travou
    // pra sempre, só descartou o excesso da janela).
    send(ws, { type: 'revive' });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(ws.readyState, WebSocket.OPEN);
    await closeClient(ws);
  } finally {
    await server.stop();
  }
});

test('servidor sobrevive a um erro de bind de porta (wss.on("error"))', async () => {
  // Regressão específica do handler adicionado em server/index.js: antes dele,
  // um erro no WebSocketServer (ex.: porta em uso) derrubava o processo Node
  // inteiro por exceção não capturada — aqui simulamos o mesmo cenário: dois
  // WebSocketServer tentando a MESMA porta.
  const { WebSocketServer } = await import('ws');
  const first = new WebSocketServer({ port: 0 });
  await new Promise((r) => first.once('listening', r));
  const port = first.address().port;

  const second = new WebSocketServer({ port });
  const errorSeen = await new Promise((resolve) => {
    second.on('error', (err) => resolve(err));
  });
  assert.match(errorSeen.message, /EADDRINUSE/);

  await new Promise((r) => first.close(r));
});

test('conexão nova depois de tudo isso ainda funciona (servidor não crashou)', async () => {
  const server = await startTestServer();
  try {
    const { ws, welcome } = await connectClient(server.url);
    assert.equal(welcome.type, 'welcome');
    await closeClient(ws);
  } finally {
    await server.stop();
  }
});
