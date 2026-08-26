// Funções puras de src/net/protocol.js — sem servidor, sem mock, só entrada/saída.
// Regra de ouro do arquivo (protocol.js:1-6, "nenhum import") já garante que ele
// roda igual em Node e no browser, o que faz destes os testes mais baratos e
// estáveis do projeto: qualquer mudança aqui afeta cliente E servidor ao mesmo
// tempo, exatamente o tipo de arquivo onde um teste vale mais que a média.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onlineLayoutFor, makeInputPayload, makePaintStroke, ONLINE_LAYOUTS } from '../../src/net/protocol.js';

test('onlineLayoutFor: determinístico pro mesmo timestamp', () => {
  const t = Date.parse('2026-08-25T10:00:00Z');
  assert.equal(onlineLayoutFor(t), onlineLayoutFor(t));
});

test('onlineLayoutFor: só devolve valores de ONLINE_LAYOUTS', () => {
  // Amostra 48 horas cheias — cobre uma volta inteira do índice, qualquer que
  // seja o tamanho de ONLINE_LAYOUTS hoje ou no futuro.
  for (let h = 0; h < 48; h++) {
    const t = h * 3600000;
    assert.ok(ONLINE_LAYOUTS.includes(onlineLayoutFor(t)), `layout inválido na hora ${h}`);
  }
});

test('onlineLayoutFor: muda só na virada da hora, nunca no meio dela', () => {
  const hourStart = 10 * 3600000;
  const justBefore = hourStart - 1;
  const justAfter = hourStart;
  // Não afirma QUAL layout (depende de ONLINE_LAYOUTS.length), só que a
  // transição acontece exatamente na fronteira, não antes nem depois.
  assert.equal(onlineLayoutFor(justBefore), onlineLayoutFor(hourStart - 500));
  assert.equal(onlineLayoutFor(justAfter), onlineLayoutFor(hourStart + 500));
});

test('makeInputPayload: arredonda pra 3 casas decimais (precisão de milímetro)', () => {
  const payload = makeInputPayload({
    pos: { x: 1.23456789, y: 0.72, z: 10 },
    yaw: 3.14159265,
    state: 'grounded',
    crouched: true,
    prone: false,
    statue: false,
    moving: true,
    color: [0x112233, 0x445566],
  });
  assert.deepEqual(payload.p, [1.235, 0.72, 10]);
  assert.equal(payload.y, 3.142);
  assert.equal(payload.c, 1);
  assert.equal(payload.r, 0);
  assert.equal(payload.m, 1);
  assert.deepEqual(payload.col, [0x112233, 0x445566]);
});

test('makePaintStroke: down vira 0/1, uv/raio arredondados', () => {
  const stroke = makePaintStroke({ down: true, uv: { x: 0.123456, y: 0.987654 }, colorHex: '#ff00ff', radiusFrac: 0.05001 });
  assert.equal(stroke.d, 1);
  assert.equal(stroke.u, 0.123);
  assert.equal(stroke.v, 0.988);
  assert.equal(stroke.c, '#ff00ff');
  assert.equal(stroke.r, 0.05);
});
