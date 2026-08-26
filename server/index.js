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

const room = new Room();
room.start();

const wss = new WebSocketServer({ port: PORT, maxPayload: MAX_WS_PAYLOAD_BYTES });

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
  room.addClient(ws, req);
});

// Mesmo motivo do handler acima, mas pro servidor como um todo (erro de bind
// de porta, etc.) — sem isto, um erro aqui também derrubaria o processo.
wss.on('error', (err) => {
  console.error('[server] erro no WebSocketServer:', err.message);
});

wss.on('listening', () => {
  console.log(`[server] ws://localhost:${PORT} — sala única, aguardando jogadores`);
});

process.on('SIGINT', () => {
  console.log('\n[server] encerrando...');
  wss.close(() => process.exit(0));
});
