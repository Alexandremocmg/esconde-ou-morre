// Infraestrutura compartilhada dos testes do servidor Online (docs/PLANO_MULTIPLAYER.md).
//
// Decisão de arquitetura: os testes aqui sobem um `Room` + `WebSocketServer` DE
// VERDADE (porta efêmera via `port: 0`, não mockada) e conectam com o cliente `ws`
// real, em vez de simular objetos de socket fake. Mesmo princípio que a skill de
// level-design já documenta para o modo Online ("teste headless com `ws` cru contra
// o `Room` real") — testar contra a peça de verdade pega bugs de protocolo/timing
// que uma dublê de `ws` esconderia (e evita manter uma 2ª implementação da API do
// `ws` só pra teste, que apodreceria sem ninguém notar).
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { Room } from './room.js';

// Mesmo valor de server/index.js — mantido em sync manualmente (arquivo pequeno,
// duplicar é mais simples que importar de um index.js que também faz bind de porta
// fixa via process.argv, o que não serve pra testes paralelos).
const MAX_WS_PAYLOAD_BYTES = 64 * 1024;

// Sobe um servidor isolado numa porta livre. `port: 0` deixa o SO escolher —
// necessário pra rodar arquivos de teste em paralelo sem colisão de porta.
export async function startTestServer() {
  const room = new Room();
  room.start();
  const wss = new WebSocketServer({ port: 0, maxPayload: MAX_WS_PAYLOAD_BYTES });
  wss.on('connection', (ws, req) => {
    ws.on('error', () => {}); // mesmo padrão de index.js — silencioso no teste
    room.addClient(ws, req);
  });
  wss.on('error', () => {});

  await new Promise((resolve) => wss.once('listening', resolve));
  const port = wss.address().port;

  return {
    room,
    port,
    url: `ws://localhost:${port}`,
    async stop() {
      room.stop();
      // `wss.close()` só chama o callback depois que TODA conexão ainda aberta
      // termina — e o handshake de fechamento gracioso de um `ws` individual
      // (closeClient) ocasionalmente não completa a tempo neste ambiente
      // (observado: um `ws.close()` do lado do cliente cujo evento 'close'
      // nunca chegou a disparar, travando o teste indefinidamente — sem
      // timeout aqui, ESSE bug de infra de teste é pior que qualquer bug real
      // que ela deveria pegar). `terminate()` força o socket a fechar na
      // marra antes de pedir pro servidor encerrar — teste não precisa de
      // handshake gracioso, só precisa não travar.
      for (const client of wss.clients) {
        try { client.terminate(); } catch (_) {}
      }
      await new Promise((resolve) => wss.close(resolve));
    },
  };
}

// A sala transmite SNAPSHOT pra todo mundo a 20Hz (TICK_MS) o tempo todo que
// há gente conectada — inclusive durante um teste. Um `ws.once('message', ...)`
// anexado só DEPOIS de `await`ar o 'open' tem uma janela real de corrida: se a
// mensagem chegar nesse meio-tempo, o listener perde ela (eventos sem ouvinte
// não ficam esperando) e pega o PRÓXIMO evento — na prática, muitas vezes um
// SNAPSHOT no lugar do WELCOME que o teste queria. Fix: fila por-socket
// (`_attachQueue`) alimentada por um listener ÚNICO e PERSISTENTE, anexado no
// mesmo tick síncrono da criação do `WebSocket` — antes que qualquer I/O real
// possa disparar. `nextMessage`/`waitForMessage` só drenam essa fila.
function attachQueue(ws) {
  if (ws._queue) return ws._queue;
  const queue = { buffered: [], waiters: [] };
  ws._queue = queue;
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const waiter = queue.waiters.shift();
    if (waiter) waiter(msg);
    else queue.buffered.push(msg);
  });
  return queue;
}

// Abre a conexão crua e já anexa a fila ANTES de esperar 'open' — a mesma
// janela de corrida do comentário acima se aplica a qualquer conexão, não só
// `connectClient`. Use isto direto quando o teste precisar decidir sozinho o
// que esperar como 1ª mensagem (ex.: sala cheia manda MATCH_OVER, não WELCOME).
export async function rawConnect(url, extraPath = '') {
  const ws = new WebSocket(url + extraPath);
  attachQueue(ws); // ANTES do 'open' — não depois, ver comentário acima
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
}

// Conecta um cliente `ws` cru e devolve tanto o socket quanto o WELCOME já
// parseado — praticamente todo teste precisa dos dois.
export async function connectClient(url, extraPath = '') {
  const ws = await rawConnect(url, extraPath);
  const welcome = await nextMessage(ws);
  return { ws, welcome };
}

// Espera a PRÓXIMA mensagem que chegar neste socket, na ordem em que chegou
// (drena a fila em FIFO) — não filtra por tipo. Use `waitForMessage` quando
// precisar ignorar SNAPSHOTs de ambiente e esperar um tipo específico.
export function nextMessage(ws, timeoutMs = 2000) {
  const queue = attachQueue(ws);
  if (queue.buffered.length) return Promise.resolve(queue.buffered.shift());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout esperando mensagem do servidor')), timeoutMs);
    queue.waiters.push((msg) => { clearTimeout(timer); resolve(msg); });
  });
}

// Espera a próxima mensagem cujo `predicate(msg)` seja verdadeiro, descartando
// (não devolvendo pra ninguém) qualquer SNAPSHOT ou outro tipo no meio do
// caminho — necessário porque a sala nunca para de transmitir SNAPSHOT
// enquanto o teste está rodando. Devolve `null` (não rejeita) se o timeout
// vencer sem achar — testes que verificam "isto NÃO deveria chegar" usam isso
// pra diferenciar "realmente não chegou" de "chegou outra coisa no meio".
export async function waitForMessage(ws, predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    let msg;
    try { msg = await nextMessage(ws, remaining); } catch (_) { return null; }
    if (predicate(msg)) return msg;
  }
}

export function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

// Fecha um cliente e espera o handshake de fechamento completar — com um teto:
// se o evento 'close' não disparar a tempo (visto acontecer neste ambiente),
// força com `terminate()` em vez de travar o teste pra sempre.
export function closeClient(ws, timeoutMs = 1000) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    const timer = setTimeout(() => { try { ws.terminate(); } catch (_) {} resolve(); }, timeoutMs);
    ws.once('close', () => { clearTimeout(timer); resolve(); });
    ws.close();
  });
}
