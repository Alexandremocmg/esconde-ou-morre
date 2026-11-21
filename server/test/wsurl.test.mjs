// resolveWsUrl (src/Net.js): qual servidor WebSocket cada tipo de página usa.
// Roda em Node com `location` e `sessionStorage` simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWsUrl } from '../../src/Net.js';
import { PROD_WS_URL } from '../../src/net/protocol.js';

function comPagina({ protocol = 'https:', hostname, host = hostname, search = '', sala = null }, fn) {
  const antes = { location: globalThis.location, sessionStorage: globalThis.sessionStorage };
  globalThis.location = { protocol, hostname, host, search };
  globalThis.sessionStorage = { getItem: (k) => (k === 'eom-room-code' ? sala : null) };
  try {
    return fn();
  } finally {
    globalThis.location = antes.location;
    globalThis.sessionStorage = antes.sessionStorage;
  }
}

test('domínio próprio: usa o mesmo host em /ws, com wss em https', () => {
  const url = comPagina({ hostname: 'esconde.kabemmanager.online' }, resolveWsUrl);
  assert.equal(url, 'wss://esconde.kabemmanager.online/ws');
});

test('domínio próprio: o código da sala vai na query', () => {
  const url = comPagina({ hostname: 'esconde.kabemmanager.online', sala: 'ABCD' }, resolveWsUrl);
  assert.equal(url, 'wss://esconde.kabemmanager.online/ws?room=ABCD');
});

test('outro domínio (Vercel) continua no servidor de produção do Render', () => {
  const url = comPagina({ hostname: 'esconde-ou-morre.vercel.app' }, resolveWsUrl);
  assert.equal(url, PROD_WS_URL);
});

test('um domínio que só termina parecido não conta como domínio próprio', () => {
  const url = comPagina({ hostname: 'kabemmanager.online.evil.example' }, resolveWsUrl);
  assert.equal(url, PROD_WS_URL);
});

test('localhost segue usando a porta 8787 do próprio host', () => {
  const url = comPagina({ protocol: 'http:', hostname: 'localhost', host: 'localhost:8000' }, resolveWsUrl);
  assert.equal(url, 'ws://localhost:8787');
});

test('?ws= explícito vence tudo', () => {
  const url = comPagina({ hostname: 'esconde.kabemmanager.online', search: '?ws=meu.host:9999' }, resolveWsUrl);
  assert.equal(url, 'wss://meu.host:9999');
});
