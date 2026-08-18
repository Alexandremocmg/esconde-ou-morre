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

const room = new Room();
room.start();

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws, req) => {
  // `req` (o upgrade HTTP original) carrega a query string — é onde uma tentativa
  // de reconexão manda `?rejoin=<id>:<token>` (ver room.js:_parseRejoin/Net.js).
  room.addClient(ws, req);
});

wss.on('listening', () => {
  console.log(`[server] ws://localhost:${PORT} — sala única, aguardando jogadores`);
});

process.on('SIGINT', () => {
  console.log('\n[server] encerrando...');
  wss.close(() => process.exit(0));
});
