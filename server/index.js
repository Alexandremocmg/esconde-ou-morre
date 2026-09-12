// Servidor autoritativo — fatia vertical v1 (docs/PLANO_MULTIPLAYER.md).
//
// Isolado em server/: é o PRIMEIRO package.json do repo, deliberadamente separado do
// cliente para não introduzir nenhum toolchain lá (docs/PLANO_VERTICAL_SLICE.md:8 —
// "ES Modules puros, sem bundler" — continua valendo para src/).
//
// Rodar: cd server && npm install && npm start  (padrão: porta 8787)

import { WebSocketServer } from 'ws';
import { Room } from './room.js';

const PORT = parseInt(process.argv[2] || process.env.PORT || '8787', 10);

// Maior mensagem legítima é PAINT (protocol.js:MAX_PAINT_STROKES_PER_MSG=400
// traços, ~80 bytes cada em JSON ≈ 32KB) — 64KB dá folga confortável sem
// deixar a porta aberta pro default do `ws` (100 MiB por mensagem: um
// cliente malicioso podia mandar uma única mensagem gigante pro processo
// bufferizar/tentar JSON.parse, sem custo nenhum pro atacante).
const MAX_WS_PAYLOAD_BYTES = 64 * 1024;

const rooms = new Map();
let publicRoomSequence = 0;
function roomCode(req) {
  try {
    const value = new URL(req.url || '/', 'ws://localhost').searchParams.get('room');
    return /^[A-Z0-9]{4,8}$/.test(value || '') ? value : 'PUBLIC';
  } catch (_) { return 'PUBLIC'; }
}
function rejoinCredentials(req) {
  try {
    const raw = new URL(req.url || '/', 'ws://localhost').searchParams.get('rejoin');
    if (!raw) return null;
    const separator = raw.indexOf(':');
    if (separator < 1) return null;
    return { id: raw.slice(0, separator), token: raw.slice(separator + 1) };
  } catch (_) { return null; }
}
function createRoom(key) {
  const room = new Room();
  room.start();
  rooms.set(key, room);
  return room;
}
function getRoom(code, req) {
  // Uma reconexão precisa voltar à instância exata, inclusive quando várias salas
  // públicas estão ativas ao mesmo tempo.
  const rejoin = rejoinCredentials(req);
  if (rejoin) {
    if (code !== 'PUBLIC') {
      const codedRoom = rooms.get(`CODE:${code}`);
      if (codedRoom?.canReattach(rejoin.id, rejoin.token)) return codedRoom;
    } else {
      for (const [key, room] of rooms) {
        if (key.startsWith('PUBLIC:') && room.canReattach(rejoin.id, rejoin.token)) return room;
      }
    }
  }

  if (code === 'PUBLIC') {
    for (const [key, room] of rooms) {
      if (key.startsWith('PUBLIC:') && room.canAcceptFreshClient()) return room;
    }
    return createRoom(`PUBLIC:${++publicRoomSequence}`);
  }

  const key = `CODE:${code}`;
  let room = rooms.get(key);
  if (!room) {
    room = createRoom(key);
  }
  return room;
}

const wss = new WebSocketServer({ port: PORT, maxPayload: MAX_WS_PAYLOAD_BYTES });

// Salas vazias deixam de consumir o tick e a memória do processo. A vaga de uma
// sala com alguém desconectado ainda é preservada pelo próprio Room durante a
// janela de reconexão; só removemos quando não há nenhum estado restante.
const roomCleanup = setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.clients.size === 0) {
      room.stop();
      rooms.delete(code);
    }
  }
}, 30000);

wss.on('connection', (ws, req) => {
  // Sem NENHUM listener de 'error' num `ws` individual, um erro de socket
  // (reset de conexão, frame malformado, etc.) vira exceção não capturada e
  // derruba o PROCESSO INTEIRO (comportamento padrão de EventEmitter do
  // Node) — todo mundo na sala cairia junto por causa de uma conexão ruim
  // de uma pessoa só. Registrado antes de qualquer outra coisa tocar `ws`.
  ws.on('error', (err) => {
    console.warn('[server] erro de socket:', err.message);
  });
  // `req` (o upgrade HTTP original) carrega a query string — é onde uma tentativa
  // de reconexão manda `?rejoin=<id>:<token>` (ver room.js:_parseRejoin/Net.js).
  getRoom(roomCode(req), req).addClient(ws, req);
});

// Mesmo motivo do handler acima, mas pro servidor como um todo (erro de bind
// de porta, etc.) — sem isto, um erro aqui também derrubaria o processo.
wss.on('error', (err) => {
  console.error('[server] erro no WebSocketServer:', err.message);
});

wss.on('listening', () => {
  console.log(`[server] ws://localhost:${PORT} — salas por código, aguardando jogadores`);
});

process.on('SIGINT', () => {
  console.log('\n[server] encerrando...');
  clearInterval(roomCleanup);
  for (const room of rooms.values()) room.stop();
  wss.close(() => process.exit(0));
});
