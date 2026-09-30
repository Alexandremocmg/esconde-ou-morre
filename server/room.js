// Sala autoritativa — fatia vertical v1 (docs/PLANO_MULTIPLAYER.md).
//
// Autoridade do servidor nesta fase: PAPEL (inclusive a rotação do Caçador a cada
// revanche), FASE/TIMER, TIRO e ELIMINAÇÃO. Posição é enviada pelo cliente: o servidor
// limita VELOCIDADE e TELEPORTE (_validateMove), mas não simula colisão nem gravidade —
// atravessar parede na velocidade normal ainda passa (Débito 1 do plano: fecha de vez
// quando Player.js ganhar um núcleo de simulação sem apresentação/DOM que o servidor
// também possa rodar). Isso é uma escolha registrada, não um descuido.
//
// Importa src/net/protocol.js e src/net/hittest.js *verbatim* — os mesmos arquivos
// que o cliente usa. É o que garante que "o servidor decide o acerto" e "o cliente
// decide o acerto" nunca divirjam: é literalmente a mesma função.

import { randomUUID } from 'node:crypto';
import {
  TICK_MS,
  CLIENT_TIMEOUT_MS,
  RECONNECT_GRACE_MS,
  C2S,
  S2C,
  ROLE,
  JET_RANGE,
  HUNTER_AIM_HALF_ANGLE_DEG,
  HUNTER_FIRE_COOLDOWN_MS,
  HUNTER_MISS_COOLDOWN_MS,
  AIM_TOLERANCE_DEG,
  MATCH_DURATION_S,
  onlineLayoutFor,
  GROUND_Y,
  HUNTER_AMMO_DEFAULT,
  MAX_CHAMELEONS,
  MATCHMAKING_WAIT_MS,
  MAX_PAINT_STROKES_PER_MSG,
} from '../src/net/protocol.js';
import { coneCandidates, normalize } from '../src/net/hittest.js';
import { OCCLUDERS_BY_LAYOUT, isOccluded } from '../src/net/occluders.js';
import { navFor } from './nav.js';
import { initBotAI, updateBotAI } from './botAI.js';

// Lobby maior (docs/PLANO_LOBBY_MULTIPLAYER.md): a sala inteira é 1 Caçador +
// MAX_CHAMELEONS Camaleões — a atribuição de papel (mais abaixo) já dava HUNTER só pro
// 1º e CHAMELEON pra todo o resto, então só o limite de capacidade precisava mudar.
const ROOM_CAPACITY = 1 + MAX_CHAMELEONS;

// Rate limit por cliente (_onMessage): o cliente legítimo manda INPUT no máximo a
// TICK_HZ (20/s, protocol.js) + ocasionais FIRE/PAINT/JOIN/REVIVE — 40/s dá 2x de
// folga sobre isso sem deixar um cliente malicioso inundar o processo com
// JSON.parse + trabalho de jogo em cada mensagem (o `maxPayload` do WebSocketServer
// em index.js limita o TAMANHO de cada mensagem, não a FREQUÊNCIA).
const MAX_MSGS_PER_SEC = 40;

// Validação de movimento (_validateMove). O servidor ainda não simula colisão, mas
// precisa impedir que um cliente adulterado ande mais rápido que o jogo permite ou
// "teletransporte" (chegar ao Camaleão, ou sair de um tiro). Limites derivados do
// Player.js real, com folga — um falso positivo aqui é PIOR que um trapaceiro
// raro, porque corrige a posição de alguém honesto:
//  • horizontal: TUNE.moveSpeed (Tuning.js) vale 8.25 por padrão e o painel de dev
//    (?tune=1) vai até 10; 10.5 cobre isso com 5% de sobra. Agachar só reduz.
//  • subida: pulo 6.2 m/s, pulo da parede 5.5, escalada 5.5 (Player.js) → 8.
//  • queda: GRAVITY=22 sem velocidade terminal; a maior queda do mapa (ático→térreo
//    do Chameleon Manor, ~11m) chega a ~22 m/s → 26.
// O limite é um "crédito" em metros que recarrega com o TEMPO REAL e tem teto de
// MOVE_BURST_S: tolera pacotes agrupados pela rede, picos de latência e os saltos
// legítimos de 1m do encaixe na parede (toggleLatch), mas a taxa SUSTENTADA de quem
// trapaceia fica travada no limite — ao contrário de "distância máxima por pacote",
// que deixaria passar ~2x a velocidade só pelo tamanho da folga.
const MAX_MOVE_SPEED_XZ = 10.5;
const MAX_RISE_SPEED = 8;
const MAX_FALL_SPEED = 26;
const MOVE_BURST_S = 0.75;
// Depois que o SERVIDOR move alguém (revanche, promoção), entradas que já estavam
// em trânsito com a posição antiga chegam "longe demais". Nessa janela elas são
// descartadas em silêncio, sem corrigir nem contar como violação.
const TELEPORT_GRACE_MS = 1000;

// Pontos de spawn do Caçador copiados de Level.js (this.spawn.set(...) de cada
// layout elegível pro Online — protocol.js:ONLINE_LAYOUTS). `y: GROUND_Y`, não 0 —
// Player.position (o que os snapshots reais vão carregar) é a altura do CENTRO da
// cápsula, não a altura do chão; o spawn sintético precisa começar consistente com
// isso (bug real já corrigido: avatares remotos flutuavam 2×GROUND_Y — ver protocol.js).
const HUNTER_SPAWN_BY_LAYOUT = {
  1: { x: -6, y: GROUND_Y, z: 8 },   // mansão (salão) — this.spawn.set(-6, 0, 8)
  4: { x: 0, y: GROUND_Y, z: -2 },   // fábrica — this.spawn.set(0, 0, -2)
  5: { x: 0, y: GROUND_Y, z: 0 },    // Chameleon Manor (térreo/Ballroom) — this.spawn.set(0, 0, 0)
};

// Base dos spawns dos Camaleões por layout: mesmo canto/área aberta de onde o Caçador
// nasce. Com N Camaleões, cada um pega um ponto num anel ao redor desta base pra não
// nascer empilhado em cima dos outros — ver `_chameleonSpawn`.
const CHAMELEON_SPAWN_BASE_BY_LAYOUT = {
  1: { x: -3, z: 8 },  // mesmo canto SW aberto do Caçador
  4: { x: 0, z: 1.5 }, // piso aberto central, longe dos tanques de tinta (±3,∓3) e das escadas (x=0, |z|>=6)
  5: { x: 0, z: 0 },   // centro do Ballroom, longe do pilar central (0,-13) e do anel de pilares (raio 10 de (0,-8))
};
const CHAMELEON_SPAWN_RADIUS_BY_LAYOUT = {
  1: 2.2, // ainda dentro do cômodo aberto, testado sem colisão
  4: 1.6, // idem — clareia os tanques (raio ~2.55 da origem) e a escada
  5: 2.0, // clareia o pilar em anel mais próximo (~3.4m da origem) com folga
};

// `index` é a ordem de entrada entre os Camaleões (0, 1, 2...), não um id — divide o
// círculo em MAX_CHAMELEONS fatias iguais. Sem validação contra geometria (Débito 1 do
// plano original): o controlador do jogador já resolve colisão a partir do 1º frame,
// igual sempre aconteceu com o ponto único.
function _chameleonSpawn(layout, index) {
  const base = CHAMELEON_SPAWN_BASE_BY_LAYOUT[layout] || CHAMELEON_SPAWN_BASE_BY_LAYOUT[1];
  const radius = CHAMELEON_SPAWN_RADIUS_BY_LAYOUT[layout] || CHAMELEON_SPAWN_RADIUS_BY_LAYOUT[1];
  const angle = (index * 2 * Math.PI) / MAX_CHAMELEONS;
  return {
    x: base.x + radius * Math.cos(angle),
    y: GROUND_Y,
    z: base.z + radius * Math.sin(angle),
  };
}

export class Room {
  constructor() {
    this.clients = new Map(); // id -> ClientState
    this.bots = new Map();    // id -> estado autoritativo de Camaleão IA
    this._botSpots = new Map(); // índice de esconderijo -> id da IA que o reservou (botAI.js)
    this._matchmakingDeadline = 0;
    this._matchStartAt = 0;
    this._over = false;
    this._phase = 'matchmaking';
    this._roundId = 1;
    this._readyIds = new Set();
    this._interval = null;
    // Layout desta sala — decidido UMA VEZ quando o 1º cliente entra numa sala vazia
    // (ver _freshJoin, `holders.length === 0`) e mantido fixo pro resto da vida da
    // sala, mesmo que a hora vire no meio da partida (onlineLayoutFor() só é
    // CONSULTADO na formação — se fosse chamado de novo a cada disparo/reconexão,
    // dois pontos da MESMA sala poderiam discordar sobre a geometria caso o relógio
    // virasse durante a partida). `Room` é uma instância ÚNICA pro processo inteiro
    // (server/index.js), não uma por partida — por isso não dá pra só calcular aqui
    // no construtor: o processo roda por horas, a sala esvazia e reforma várias
    // vezes, e cada reformação é uma chance nova de rotação.
    this._layout = onlineLayoutFor();
  }

  start() {
    if (this._interval) return;
    this._interval = setInterval(() => this._tick(), TICK_MS);
    console.log(`[room] tick loop a cada ${TICK_MS.toFixed(1)}ms`);
  }

  // Só usado por test/helpers.mjs (cada teste sobe uma Room própria — sem
  // parar o interval, o processo do test runner nunca fecha sozinho) e
  // opcionalmente por um shutdown gracioso no futuro. Produção hoje sai por
  // process.exit() direto (index.js:SIGINT), então nunca precisou disto.
  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  }

  // ------------------------------------------------------------- ciclo de vida
  // Ponto de entrada de toda conexão nova. Primeiro tenta RECONECTAR a um cliente
  // que caiu há pouco (identidade vem na própria URL de upgrade do WebSocket —
  // `?rejoin=<id>:<token>`, ver _parseRejoin/Net.js) e, se não der, segue o fluxo
  // de entrada nova de sempre.
  addClient(ws, req) {
    const rejoin = this._parseRejoin(req);
    if (rejoin && this._reattach(ws, rejoin)) return;
    this._freshJoin(ws);
  }

  // Lê `?rejoin=<id>:<token>` da URL de upgrade. `id` é um UUID (nunca contém
  // ':'), então dividir na primeira ocorrência é seguro.
  _parseRejoin(req) {
    if (!req || !req.url) return null;
    try {
      const raw = new URL(req.url, 'http://localhost').searchParams.get('rejoin');
      if (!raw) return null;
      const i = raw.indexOf(':');
      if (i < 0) return null;
      return { id: raw.slice(0, i), token: raw.slice(i + 1) };
    } catch (_) {
      return null;
    }
  }

  // Reata um `ws` NOVO a um client EXISTENTE (ainda dentro de RECONNECT_GRACE_MS —
  // se já foi purgado por _purgeStale, `this.clients` nem tem mais o id, e isto
  // devolve false, caindo pro fluxo de entrada nova). O token evita que qualquer
  // um que veja o id (broadcast em todo SNAPSHOT) sequestre a sessão de outro
  // jogador — não é segurança de verdade (sem TLS mútuo/assinatura), só o
  // suficiente pra não ser trivial; mesmo nível de confiança que o resto da v1
  // (Débito 1: movimento só tem teto de velocidade, não é re-simulado).
  _reattach(ws, { id, token }) {
    const client = this.clients.get(id);
    if (!client || client.connected || client.token !== token) return false;

    client.ws = ws;
    client.connected = true;
    client.lastInputAt = Date.now();
    // O cliente continua se auto-simulando durante a queda (Game.js:_connectOnline),
    // então o 1º input depois de reconectar pode vir de longe. O crédito de
    // movimento dessa 1ª entrada vale o tempo REAL da queda (sem o teto de rajada,
    // que só volta depois dela): dá pra ressincronizar sem teletransporte grátis —
    // derrubar a conexão de propósito não rende mais que correr esse tempo todo.
    client._resync = true;

    this._send(ws, {
      type: S2C.WELCOME,
      id: client.id, role: client.role, spawn: client.spawn, layout: this._layout,
      matchDuration: MATCH_DURATION_S, token: client.token, eliminated: client.eliminated,
      matchmakingDeadline: this._matchmakingDeadline,
      matchStartAt: this._matchStartAt,
      phase: this._phase, roundId: this._roundId,
      readyCount: this._readyIds.size, readyRequired: this.clients.size,
      self: this._publicStateFull(client),
      players: this._participants()
        .filter((c) => c.id !== id && (c.isBot || c.connected))
        .map((c) => this._publicStateFull(c)),
    });
    console.log(`[room] reconectou ${id} como ${client.role} (${this.clients.size} na sala)`);

    ws.on('message', (raw) => this._onMessage(client, raw));
    ws.on('close', () => this._onDisconnect(client));
    return true;
  }

  _freshJoin(ws) {
    // Conta TODO mundo na sala, não só quem está `connected` agora — um cliente
    // caído mas ainda dentro da janela de tolerância continua "ocupando" a vaga e
    // o papel dele, senão um 3º dispositivo poderia roubar o papel de quem só
    // teve uma queda de wifi de alguns segundos.
    const holders = [...this.clients.values()];
    if (holders.length >= ROOM_CAPACITY) {
      this._send(ws, { type: S2C.MATCH_OVER, winner: null, reason: 'sala cheia' });
      ws.close(4001, 'sala cheia');
      return;
    }
    // Depois que a caçada começa, a composição fica congelada. Assim uma pessoa
    // nova não substitui uma IA no meio da rodada nem surge dentro do mapa sem lobby.
    if (this._matchStartAt) {
      this._send(ws, { type: S2C.MATCH_OVER, winner: null, reason: 'partida em andamento' });
      ws.close(4002, 'partida em andamento');
      return;
    }

    // Sala virou de vez (0 clientes, nem os em graça de reconexão): reabre a
    // escolha de mapa — mesma rotação determinística de Game.js, mas só CONSULTADA
    // aqui na formação (ver comentário no construtor sobre por que não a cada tick).
    if (holders.length === 0) {
      this._layout = onlineLayoutFor();
      this.bots.clear();
      this._botSpots.clear();
      this._matchStartAt = 0;
      this._matchmakingDeadline = Date.now() + MATCHMAKING_WAIT_MS;
      this._phase = 'matchmaking';
      this._readyIds.clear();
    }

    const id = randomUUID();
    const token = randomUUID();
    const takenRoles = new Set(holders.map((c) => c.role));
    const role = takenRoles.has(ROLE.HUNTER) ? ROLE.CHAMELEON : ROLE.HUNTER;
    // Índice de entrada ENTRE os Camaleões (0, 1, 2...) — decide a fatia do anel de
    // spawn deste (`_chameleonSpawn`). Irrelevante pro Caçador, que tem ponto fixo.
    const chameleonIndex = holders.filter((c) => c.role === ROLE.CHAMELEON).length;
    const spawn = role === ROLE.HUNTER
      ? (HUNTER_SPAWN_BY_LAYOUT[this._layout] || HUNTER_SPAWN_BY_LAYOUT[1])
      : _chameleonSpawn(this._layout, chameleonIndex);

    const client = {
      id, token, ws, role, connected: true,
      spawn, // guardado pra WELCOME de reconexão reusar o MESMO ponto (_reattach), não
             // recalcular por índice — a contagem de Camaleões pode ter mudado desde então.
      pos: { ...spawn }, yaw: 0, state: 'grounded',
      crouched: false, prone: false, statue: false, moving: false,
      color: [0xeef0f2, 0xeef0f2],
      eliminated: false,
      nextFireAt: 0,
      lastInputAt: Date.now(),
      disconnectedAt: 0,
      // Rotação do Caçador (_pickNextHunter): quantas rodadas já caçou e em qual foi a
      // última — quem entra como Caçador já conta a rodada atual.
      hunterRounds: role === ROLE.HUNTER ? 1 : 0,
      lastHunterRound: role === ROLE.HUNTER ? this._roundId : 0,
      // Validação de movimento (_validateMove) — créditos começam cheios.
      _moveAt: Date.now(),
      _creditXZ: MAX_MOVE_SPEED_XZ * MOVE_BURST_S,
      _creditUp: MAX_RISE_SPEED * MOVE_BURST_S,
      _creditDown: MAX_FALL_SPEED * MOVE_BURST_S,
      _teleportGraceUntil: 0,
      _resync: false,
      speedViolations: 0,
      // Rate limit (_onMessage) — janela deslizante de 1s, reiniciada sozinha na
      // primeira mensagem de cada janela nova (ver _onMessage). Sobrevive a
      // _reattach de propósito (o client object é reaproveitado, não recriado).
      _msgWindowStart: Date.now(),
      _msgCount: 0,
      // Munição: valores por padrão, corrigidos por _handleJoin() assim que o JOIN
      // chegar (sempre antes do primeiro tiro possível — ver protocol.js C2S.JOIN).
      // Só importa pra quem é HUNTER; o Camaleão nunca lê os próprios.
      ammo: HUNTER_AMMO_DEFAULT,
      maxAmmo: HUNTER_AMMO_DEFAULT,
      infiniteAmmo: false,
      joinConfigured: false,
      // Fase 4 do pincel 3D: acumulado de comandos de traço já
      // validados deste cliente — só pra um jogador que entra DEPOIS ver a
      // pintura de quem já estava (ver WELCOME/_reattach, que inclui isto
      // via _publicStateFull). NÃO vai no SNAPSHOT de todo tick — só cresceria
      // sem necessidade, o mesmo problema que a lista de comandos evita ao
      // custo de banda de pixels.
      paintStrokes: [],
    };
    this.clients.set(id, client);

    const connectedBefore = holders.filter((c) => c.connected).length;
    if (connectedBefore === 0) this._over = false;

    // Cinco pessoas encontradas: inicia imediatamente e não cria nenhuma IA.
    const connectedHumans = [...this.clients.values()].filter((c) => c.connected).length;
    if (connectedHumans === ROOM_CAPACITY) this._startMatch(Date.now());

    this._send(ws, {
      type: S2C.WELCOME,
      id, role, spawn, layout: this._layout,
      matchDuration: MATCH_DURATION_S, token, eliminated: client.eliminated, // sempre false aqui (join novo), por simetria com _reattach
      matchmakingDeadline: this._matchmakingDeadline,
      matchStartAt: this._matchStartAt,
      phase: this._phase, roundId: this._roundId,
      readyCount: this._readyIds.size, readyRequired: this.clients.size,
      self: this._publicStateFull(client),
      players: this._participants()
        .filter((c) => c.id !== id && (c.isBot || c.connected))
        .map((c) => this._publicStateFull(c)),
    });

    this._broadcast({ type: S2C.PLAYER_JOIN, player: this._publicState(client) }, id);
    console.log(`[room] entrou ${id} como ${role} (${this.clients.size} na sala)`);

    ws.on('message', (raw) => this._onMessage(client, raw));
    ws.on('close', () => this._onDisconnect(client));
  }

  canAcceptFreshClient() {
    return this._phase === 'matchmaking' && this.clients.size < ROOM_CAPACITY;
  }

  hasClient(id) {
    return this.clients.has(id);
  }

  canReattach(id, token) {
    const client = this.clients.get(id);
    return !!client && !client.connected && client.token === token;
  }

  _participants() {
    return [...this.clients.values(), ...this.bots.values()];
  }

  _startMatch(now) {
    if (this._phase !== 'matchmaking' || this._matchStartAt || this._over) return;
    const connectedHunter = [...this.clients.values()]
      .some((c) => c.connected && c.role === ROLE.HUNTER);
    if (!connectedHunter) return;
    this._fillBotSlots(now);
    this._matchmakingDeadline = 0;
    this._matchStartAt = now;
    this._phase = 'playing';
  }

  _fillBotSlots(now, replacement = null) {
    const humanChameleons = [...this.clients.values()]
      .filter((c) => c.role === ROLE.CHAMELEON).length;
    const missing = Math.max(0, MAX_CHAMELEONS - humanChameleons - this.bots.size);
    // Cor de quem ainda não copiou nenhuma superfície: a IA só muda de cor ao chegar num
    // esconderijo (botAI.js:settle), como o humano que pinta depois de escolher o lugar.
    const colors = [0x65c878, 0xd6a85f, 0x7199d4, 0xb87ac9];
    const nav = navFor(this._layout);
    // Células de spawn já usadas, pra duas IAs não nascerem na mesma célula quando o
    // anel de spawn (pensado pro jogador humano) cai sobre móvel/escada e é empurrado.
    const usedCells = new Set(
      [...this.bots.values()].map((b) => {
        const cell = nav && nav.cellOf(b.pos.x, b.pos.z);
        return cell ? nav.idx(cell.c, cell.r) : -1;
      })
    );
    for (let i = 0; i < missing; i++) {
      const index = humanChameleons + this.bots.size;
      let spawn = _chameleonSpawn(this._layout, index);
      if (nav) {
        // O spawn do humano pode cair em cima de móvel/escada (o controlador dele
        // resolve a colisão no 1º frame). A IA não: nasce na célula livre mais próxima.
        const cell = nav.nearestFree(spawn.x, spawn.z, 10, usedCells);
        if (cell) {
          const p = nav.center(cell.c, cell.r);
          spawn = { x: p.x, y: GROUND_Y, z: p.z };
          usedCells.add(nav.idx(cell.c, cell.r));
        }
      }
      const bot = {
        id: `bot-${randomUUID()}`,
        role: ROLE.CHAMELEON,
        isBot: true,
        name: `IA ${this.bots.size + 1}`,
        connected: true,
        spawn,
        pos: { ...spawn }, yaw: 0, state: 'grounded',
        crouched: false, prone: false, statue: false, moving: false,
        color: [colors[index % colors.length], colors[index % colors.length]],
        eliminated: false,
        ammo: 0, maxAmmo: 0, infiniteAmmo: false,
        paintStrokes: [],
        _rng: (index + 1) * 2654435761 >>> 0,
      };
      if (replacement && i === 0) {
        bot.eliminated = !!replacement.eliminated;
        bot.color = [...replacement.color];
        bot.pos = { ...replacement.pos };
      }
      initBotAI(bot, now);
      this.bots.set(bot.id, bot);
      this._broadcast({ type: S2C.PLAYER_JOIN, player: this._publicState(bot) });
    }
  }

  // IA autoritativa (server/botAI.js): esconderijos reais, caminhos pela grade de
  // navegação, percepção limitada do Caçador. Aqui só se monta o "mundo" que ela lê.
  _updateBots(now) {
    if (!this._matchStartAt || now < this._matchStartAt || this._over) return;
    const nav = navFor(this._layout);
    if (!nav) return; // layout sem dados de navegação: as IAs ficam onde nasceram
    const world = {
      nav,
      hunter: [...this.clients.values()].find((c) => c.connected && c.role === ROLE.HUNTER) || null,
      boxes: OCCLUDERS_BY_LAYOUT[this._layout] || OCCLUDERS_BY_LAYOUT[1],
      reserved: this._botSpots,
      botIds: new Set(this.bots.keys()),
      budget: { floods: 1 }, // uma decisão cara por tick (botAI.js:chooseSpot)
    };
    for (const bot of this.bots.values()) updateBotAI(bot, world, now);
  }

  // NÃO remove o cliente nem avisa o outro lado ainda — só marca a queda. A
  // remoção de verdade (com PLAYER_LEAVE) é _purgeStale(), chamado a cada tick,
  // quando RECONNECT_GRACE_MS esgota sem uma reconexão. Chamado tanto por um
  // 'close' limpo do WebSocket quanto pelo timeout silencioso em _tick() — este
  // último passa `at` = último input visto (não "agora"), senão uma morte
  // silenciosa só detectada CLIENT_TIMEOUT_MS depois já gastaria metade da janela
  // de tolerância antes mesmo de começarmos a contar.
  _onDisconnect(client, at = Date.now()) {
    if (!client.connected) return; // já tratado (ex.: 'close' duplicado do ws.terminate())
    client.connected = false;
    client.disconnectedAt = at;
    console.log(`[room] ${client.id} caiu — segurando a vaga por ${(RECONNECT_GRACE_MS / 1000).toFixed(0)}s`);
  }

  // Chamado a cada tick: remove de vez quem caiu e não voltou dentro da janela.
  _purgeStale(now) {
    for (const [id, c] of this.clients) {
      if (c.connected || now - c.disconnectedAt < RECONNECT_GRACE_MS) continue;
      this.clients.delete(id);
      this._broadcast({ type: S2C.PLAYER_LEAVE, id });
      console.log(`[room] ${id} não reconectou a tempo, saiu de vez (${this.clients.size} na sala)`);
      if (this._matchStartAt && !this._over && c.role === ROLE.CHAMELEON) {
        this._fillBotSlots(now, c);
      } else if (this._matchStartAt && !this._over && c.role === ROLE.HUNTER) {
        this._endMatch(ROLE.CHAMELEON, 'Caçador desconectou');
      } else if ((this._phase === 'matchmaking' || this._phase === 'results') && c.role === ROLE.HUNTER) {
        const promoted = this._pickNextHunter(
          [...this.clients.values()].filter((p) => p.connected && p.role === ROLE.CHAMELEON)
        );
        if (promoted) {
          this._makeHunter(promoted, now);
          this._broadcast({ type: S2C.ROLE_CHANGED, player: this._publicState(promoted), spawn: promoted.spawn });
        }
      }
      if (this.clients.size === 0) {
        this.bots.clear();
        this._botSpots.clear();
        this._over = false;
        this._matchStartAt = 0;
        this._matchmakingDeadline = 0;
        this._phase = 'matchmaking';
        this._readyIds.clear();
      }
    }
    if (this._phase === 'results') this._tryBeginRematch(now);
  }

  _onMessage(client, raw) {
    // Rate limit ANTES do JSON.parse — é o parse (+ o trabalho de jogo depois
    // dele) que a inundação custa caro pra evitar, não o rótulo da mensagem.
    const now = Date.now();
    if (now - client._msgWindowStart >= 1000) {
      client._msgWindowStart = now;
      client._msgCount = 0;
    }
    client._msgCount++;
    if (client._msgCount > MAX_MSGS_PER_SEC) return; // flood — ignorado em silêncio, mesmo espírito do cooldown de tiro

    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    client.lastInputAt = Date.now();

    if (msg.type === C2S.INPUT) {
      this._applyInput(client, msg);
    } else if (msg.type === C2S.FIRE) {
      this._handleFire(client, msg);
    } else if (msg.type === C2S.REVIVE) {
      this._onRevive(client);
    } else if (msg.type === C2S.JOIN) {
      this._handleJoin(client, msg);
    } else if (msg.type === C2S.PAINT) {
      this._handlePaint(client, msg);
    }
  }

  // Chega DEPOIS do WELCOME (o cliente só manda JOIN no evento 'open' do WebSocket,
  // que dispara depois de a Promise de connect() já ter sido criada) mas sempre ANTES
  // do primeiro tiro possível — dá tempo de configurar a munição antes de qualquer
  // _handleFire. Ignorado pra quem virou CHAMELEON: a escolha dele nunca importa,
  // só a de quem o servidor decidiu que é o Caçador.
  _handleJoin(client, msg) {
    if (client.role !== ROLE.HUNTER) return;
    // JOIN só configura a munição na entrada. Repeti-lo durante uma partida
    // não pode recarregar a reserva nem alternar munição infinita.
    if (client.joinConfigured) return;
    // Partida pública usa a regra competitiva da sala. Opções locais não podem
    // conceder munição infinita ou alterar o total autoritativo.
    client.infiniteAmmo = false;
    client.maxAmmo = HUNTER_AMMO_DEFAULT;
    client.ammo = client.maxAmmo;
    client.joinConfigured = true;
  }

  // "Jogar novamente" sem reconectar (Game.js:restartInPlace). Sem isto, `eliminated`
  // e `_over` ficavam presos em true pra sempre (só zeravam quando a sala esvaziava),
  // então: o avatar do Camaleão eliminado continuava sumindo (RemotePlayer.js funde a
  // escala a zero e nunca volta) e o Caçador ficava travado sem poder atirar de novo
  // (_handleFire recusa enquanto _over). Quem clicar primeiro reabre a partida pra
  // ambos — v1 não tem "pronto?" de lobby, então o 1º clique já vale.
  _onRevive(client) {
    // Só existe revanche depois que a sala encerrou a rodada. Um Camaleão
    // eliminado não pode se ressuscitar no meio da partida.
    if (!this._over) return;
    if (!client.connected) return;
    this._readyIds.add(client.id);
    this._tryBeginRematch(Date.now());
  }

  _tryBeginRematch(now) {
    if (this._phase !== 'results') return;
    const humans = [...this.clients.values()];
    if (!humans.length || !humans.every((c) => c.connected && this._readyIds.has(c.id))) return;

    for (const bot of this.bots.values()) {
      this._broadcast({ type: S2C.PLAYER_LEAVE, id: bot.id });
    }
    this.bots.clear();
    this._botSpots.clear();
    this._over = false;
    this._phase = 'matchmaking';
    this._roundId++;
    this._matchStartAt = 0;
    this._matchmakingDeadline = now + MATCHMAKING_WAIT_MS;
    this._readyIds.clear();
    // Papéis, spawns, munição e posição de TODOS mudam aqui, de uma vez, antes do
    // ROUND_RESET — o cliente lê o próprio papel desse mesmo pacote (Game.js:
    // _onRoundReset), então não existe janela em que alguém veja papéis velhos.
    this._rotateHunter(humans, now);
    for (const c of humans) {
      c.eliminated = false;
      c.nextFireAt = 0;
      c.state = 'grounded';
      c.crouched = c.prone = c.statue = c.moving = false;
    }
    this._broadcast({
      type: S2C.ROUND_RESET,
      t: now, phase: this._phase, roundId: this._roundId,
      matchmakingDeadline: this._matchmakingDeadline, matchStartAt: 0,
      players: humans.filter((c) => c.connected).map((c) => this._publicStateFull(c)),
    });
    if (humans.length === ROOM_CAPACITY) this._startMatch(now);
  }

  // Quem caça a PRÓXIMA rodada: justiça antes de ordem de chegada — menos rodadas
  // como Caçador primeiro; empate → quem caçou há mais tempo; empate → quem entrou
  // antes na sala. Assim com N pessoas todo mundo caça uma vez antes de alguém
  // repetir, e uma promoção por saída do Caçador não dá a vez a quem já caçou.
  _pickNextHunter(candidates) {
    const order = new Map([...this.clients.keys()].map((id, i) => [id, i]));
    return [...candidates].sort((a, b) =>
      a.hunterRounds - b.hunterRounds ||
      a.lastHunterRound - b.lastHunterRound ||
      order.get(a.id) - order.get(b.id)
    )[0] || null;
  }

  // Move alguém por decisão do SERVIDOR (spawn de revanche, promoção). Zera o
  // crédito de movimento e abre a janela de graça contra entradas em trânsito com
  // a posição antiga (ver TELEPORT_GRACE_MS).
  _teleport(client, pos, now) {
    client.pos = { ...pos };
    client._moveAt = now;
    client._creditXZ = MAX_MOVE_SPEED_XZ * MOVE_BURST_S;
    client._creditUp = MAX_RISE_SPEED * MOVE_BURST_S;
    client._creditDown = MAX_FALL_SPEED * MOVE_BURST_S;
    client._teleportGraceUntil = now + TELEPORT_GRACE_MS;
    client._resync = false;
  }

  // Dá o papel de Caçador: spawn do layout, regra pública de munição (a mesma de
  // _handleJoin — quem vira Caçador depois de entrar nunca mandou um JOIN válido).
  _makeHunter(client, now) {
    client.role = ROLE.HUNTER;
    client.spawn = HUNTER_SPAWN_BY_LAYOUT[this._layout] || HUNTER_SPAWN_BY_LAYOUT[1];
    client.maxAmmo = HUNTER_AMMO_DEFAULT;
    client.ammo = client.maxAmmo;
    client.infiniteAmmo = false;
    client.joinConfigured = true;
    client.hunterRounds++;
    client.lastHunterRound = this._roundId;
    this._teleport(client, client.spawn, now);
  }

  // Rotação entre rodadas: um humano caça, os outros viram Camaleões. Com um só
  // humano (o resto é IA) ele continua Caçador. Chamado DEPOIS de incrementar
  // `_roundId`, pra `lastHunterRound` registrar a rodada que vai começar.
  _rotateHunter(humans, now) {
    const next = this._pickNextHunter(humans.filter((c) => c.connected));
    let chameleonIndex = 0;
    for (const c of humans) {
      if (c === next) {
        this._makeHunter(c, now);
        continue;
      }
      c.role = ROLE.CHAMELEON;
      c.spawn = _chameleonSpawn(this._layout, chameleonIndex++);
      c.maxAmmo = HUNTER_AMMO_DEFAULT;
      c.ammo = c.maxAmmo;
      c.infiniteAmmo = false;
      c.joinConfigured = true;
      this._teleport(c, c.spawn, now);
    }
  }

  // Aceita a posição pedida pelo cliente só até onde o tempo real permite andar.
  // Devolve a posição a guardar, ou null pra descartar a entrada (graça pós-teleporte).
  // Acima do limite a posição é ENCURTADA na direção pedida, não recusada: o servidor
  // nunca congela um jogador honesto (um respawn ou uma reconexão longa se
  // ressincroniza andando na velocidade máxima), mas a taxa sustentada de quem
  // trapaceia fica travada no limite — e é essa posição que vale pra tiro e para
  // os outros jogadores verem.
  _validateMove(client, target, now) {
    const prev = client.pos;
    const dt = Math.max(0, (now - client._moveAt) / 1000);
    client._moveAt = now;
    const resync = client._resync;
    client._resync = false;
    const refill = (credit, speed) => {
      const total = credit + speed * dt;
      return resync ? total : Math.min(total, speed * MOVE_BURST_S);
    };
    client._creditXZ = refill(client._creditXZ, MAX_MOVE_SPEED_XZ);
    client._creditUp = refill(client._creditUp, MAX_RISE_SPEED);
    client._creditDown = refill(client._creditDown, MAX_FALL_SPEED);

    const dx = target.x - prev.x;
    const dz = target.z - prev.z;
    const dy = target.y - prev.y;
    const distXZ = Math.hypot(dx, dz);
    const yCredit = dy >= 0 ? client._creditUp : client._creditDown;
    const overXZ = distXZ > client._creditXZ;
    const overY = Math.abs(dy) > yCredit;

    if ((overXZ || overY) && now < client._teleportGraceUntil) return null;

    const fx = overXZ ? client._creditXZ / distXZ : 1;
    const stepY = overY ? Math.sign(dy) * yCredit : dy;
    client._creditXZ -= distXZ * fx;
    if (dy >= 0) client._creditUp -= Math.abs(stepY);
    else client._creditDown -= Math.abs(stepY);

    if (overXZ || overY) {
      client.speedViolations++;
      if (client.speedViolations === 1 || client.speedViolations % 100 === 0) {
        console.log(`[room] ${client.id} acima do limite de movimento (${client.speedViolations}x) — posição corrigida`);
      }
    }
    return { x: prev.x + dx * fx, y: prev.y + stepY, z: prev.z + dz * fx };
  }

  _applyInput(client, msg) {
    // Valores que não podem representar um jogador no mapa (não finitos, ou
    // absurdamente longe) são descartados antes de qualquer outra coisa.
    const p = msg.p;
    if (!Array.isArray(p) || p.length !== 3 || p.some((n) => !Number.isFinite(n))) return;
    if (p.some((n) => Math.abs(n) > 200)) return;
    // Velocidade/teleporte: ver _validateMove. `null` = entrada obsoleta pós-teleporte
    // do servidor, descartada por inteiro (inclusive yaw/estado — é de antes do reset).
    const accepted = this._validateMove(client, { x: p[0], y: p[1], z: p[2] }, Date.now());
    if (!accepted) return;
    client.pos = accepted;
    if (Number.isFinite(msg.y)) client.yaw = msg.y;
    client.state = msg.s === 'latched' ? 'latched' : 'grounded';
    client.crouched = !!msg.c;
    client.prone = !!msg.r;
    client.statue = !!msg.k;
    client.moving = !!msg.m;
    if (Array.isArray(msg.col) && msg.col.length === 2) client.color = msg.col;
  }

  // Fase 4 do pincel 3D — mesmo espírito de _applyInput: confia
  // na FORMA dos dados (nunca visto), mas valida os TIPOS/faixas de cada
  // campo antes de guardar/repassar — um cliente malicioso não pode mandar
  // um payload gigante (MAX_PAINT_STROKES_PER_MSG) nem um hex/UV inválido
  // que quebre o desenho no lado de quem recebe.
  _handlePaint(client, msg) {
    const strokes = msg.strokes;
    if (!Array.isArray(strokes) || !strokes.length || strokes.length > MAX_PAINT_STROKES_PER_MSG) return;

    const clean = [];
    for (const s of strokes) {
      if (!s || typeof s.u !== 'number' || typeof s.v !== 'number') continue;
      if (s.u < 0 || s.u > 1 || s.v < 0 || s.v > 1) continue;
      if (typeof s.c !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(s.c)) continue;
      if (typeof s.r !== 'number' || !(s.r > 0) || s.r > 0.5) continue;
      clean.push({ d: s.d ? 1 : 0, u: s.u, v: s.v, c: s.c, r: s.r });
    }
    if (!clean.length) return;

    // Acumulado pra quem entrar depois (ver WELCOME/_publicStateFull) — teto
    // de segurança pra não crescer sem limite numa sessão muito longa.
    client.paintStrokes = client.paintStrokes.concat(clean);
    if (client.paintStrokes.length > 2000) {
      client.paintStrokes = client.paintStrokes.slice(-2000);
    }

    this._broadcast({ type: S2C.PLAYER_PAINT, id: client.id, strokes: clean }, client.id);
  }

  // --------------------------------------------------------------- disparo
  _handleFire(client, msg) {
    const now = Date.now();
    // A busca ainda não terminou enquanto `_matchStartAt` é zero. O servidor só
    // libera tiros depois de completar as vagas humanas restantes com IA.
    if (this._over || client.role !== ROLE.HUNTER || client.eliminated) return;
    if (!this._matchStartAt || now < this._matchStartAt) return;

    if (now < client.nextFireAt) return; // spam silenciosamente ignorado (cooldown já corre no cliente)

    const origin = msg.origin, dirIn = msg.dir;
    if (!origin || !dirIn) return; // valida ANTES de gastar munição — pacote malformado não pode custar água
    if (![origin.x, origin.y, origin.z, dirIn.x, dirIn.y, dirIn.z].every(Number.isFinite)) return;
    const originDelta = Math.hypot(origin.x - client.pos.x, origin.y - client.pos.y, origin.z - client.pos.z);
    // A câmera fica alguns centímetros acima/à frente do avatar. Uma origem a
    // dezenas de metros é um tiro forjado e não deve consumir munição.
    if (originDelta > 3) return;
    const dir = normalize(dirIn);

    // Munição: mesma ordem de Game.js:fireHunterShot — gasta em TODO tiro (acerto ou
    // erro) desde que o cooldown já tenha passado. Sem som/aviso aqui: o cliente já se
    // autonega via HUD espelhado pelo SNAPSHOT (_onSnapshot em Game.js) antes de sequer
    // mandar o FIRE; chegar aqui sem munição só pode ser um cliente desonesto/dessincronizado.
    if (!client.infiniteAmmo) {
      if (client.ammo <= 0) return;
      client.ammo--;
    }

    const candidates = this._participants()
      .filter((c) => c.role === ROLE.CHAMELEON && (c.isBot || c.connected) && !c.eliminated)
      .map((c) => ({ id: c.id, pos: c.pos }));

    // Tolerância extra (AIM_TOLERANCE_DEG): o cliente mira num alvo que já está
    // atrasado pelo buffer de interpolação; o servidor só conhece a última posição
    // reportada. Sem folga, tiros honestos seriam recusados na borda do cone — ver
    // protocol.js.
    // Oclusão de parede: coneCandidates devolve a lista ordenada por ângulo de
    // propósito (comentário em hittest.js já esperava por isto) — percorre e fica
    // com o primeiro que não tem uma caixa de oclusão do MAPA DESTA SALA (this._layout)
    // no meio do caminho. Sem isto, um Camaleão atrás de uma parede dentro do
    // cone/alcance contava como acerto: lia como "acertei sem nem estar mirando
    // nele, de longe".
    const occluders = OCCLUDERS_BY_LAYOUT[this._layout] || OCCLUDERS_BY_LAYOUT[1];
    const hits = coneCandidates(origin, dir, candidates, {
      range: JET_RANGE,
      halfAngleDeg: HUNTER_AIM_HALF_ANGLE_DEG + AIM_TOLERANCE_DEG,
    }).filter((h) => !isOccluded(origin, h.pos, occluders));
    const best = hits[0] || null;

    // Jato visível (docs/PLANO_LOBBY_MULTIPLAYER.md nunca cobriu isto — era uma lacuna
    // real: o online não tinha NENHUM efeito 3D de tiro, só som+HUD). `S2C.SHOT` já
    // existia no protocolo (nunca usado) com exatamente esta forma. Broadcast pra TODO
    // MUNDO, inclusive o próprio Caçador — ninguém desenha o jato otimisticamente antes
    // disso chegar, então o servidor é a ÚNICA fonte do efeito visual (mesmo padrão de
    // autoridade do resto do disparo). `to`: posição real do alvo se acertou, ou o
    // ponto no fim do alcance na direção mirada se errou.
    const shotTo = best
      ? best.pos
      : { x: origin.x + dir.x * JET_RANGE, y: origin.y + dir.y * JET_RANGE, z: origin.z + dir.z * JET_RANGE };
    this._broadcast({ type: S2C.SHOT, hunterId: client.id, hit: !!best, targetId: best?.id ?? null, from: origin, to: shotTo });

    if (best) {
      client.nextFireAt = now + HUNTER_FIRE_COOLDOWN_MS;
      const target = this.clients.get(best.id) || this.bots.get(best.id);
      if (target) target.eliminated = true;
      this._broadcast({ type: S2C.PLAYER_HIT, targetId: best.id, hunterId: client.id });

      const remaining = this._participants()
        .filter((c) => c.role === ROLE.CHAMELEON && !c.eliminated);
      if (remaining.length === 0) this._endMatch(ROLE.HUNTER, 'todos os Camaleões eliminados');
    } else {
      client.nextFireAt = now + HUNTER_MISS_COOLDOWN_MS;
      this._send(client.ws, { type: S2C.FIRE_DENIED, reason: 'miss', nextFireAt: client.nextFireAt });
    }

    // Mesma checagem final de Game.js:fireHunterShot — se o tiro acima já eliminou o
    // último Camaleão, _endMatch(HUNTER,...) já rodou e este _endMatch(CHAMELEON,...)
    // vira um no-op (idempotente por this._over).
    if (!client.infiniteAmmo && client.ammo <= 0) {
      const stillHunting = this._participants()
        .some((c) => c.role === ROLE.CHAMELEON && !c.eliminated);
      if (stillHunting) this._endMatch(ROLE.CHAMELEON, 'Caçador sem munição');
    }
  }

  _endMatch(winner, reason) {
    if (this._over) return;
    this._over = true;
    this._phase = 'results';
    this._readyIds.clear();
    this._broadcast({ type: S2C.MATCH_OVER, winner, reason, roundId: this._roundId });
    console.log(`[room] partida encerrada: ${winner} (${reason})`);
  }

  // ------------------------------------------------------------------ tick
  _tick() {
    const now = Date.now();

    // Timeout de cliente silencioso (aba fechada sem close limpo, wifi caiu etc.)
    // — marca a queda (não deleta: _purgeStale cuida disso depois de
    // RECONNECT_GRACE_MS sem uma reconexão bem-sucedida).
    for (const c of this.clients.values()) {
      if (c.connected && now - c.lastInputAt > CLIENT_TIMEOUT_MS) {
        try { c.ws.terminate(); } catch (_) {}
        this._onDisconnect(c, c.lastInputAt);
      }
    }
    this._purgeStale(now);

    // A primeira pessoa abre a busca. Durante 30s, as vagas ficam reservadas para
    // humanos; ao vencer o prazo, apenas o que faltar vira IA.
    const hasConnectedHuman = [...this.clients.values()].some((c) => c.connected);
    if (!this._matchStartAt && !this._over && this._matchmakingDeadline &&
        now >= this._matchmakingDeadline && hasConnectedHuman) {
      this._startMatch(now);
    }
    this._updateBots(now);

    if (!this._over && this._matchStartAt && this.clients.size > 0) {
      const elapsed = (now - this._matchStartAt) / 1000;
      if (elapsed >= MATCH_DURATION_S) {
        const chameleonsAlive = this._participants()
          .some((c) => c.role === ROLE.CHAMELEON && !c.eliminated);
        this._endMatch(chameleonsAlive ? ROLE.CHAMELEON : ROLE.HUNTER, 'tempo esgotado');
      }
    }

    if (this.clients.size === 0) return;
    const players = this._participants()
      .filter((c) => c.isBot || c.connected)
      .map((c) => this._publicState(c));
    // Os dois timestamps junto de `t` deixam o cliente calcular a busca e o tempo
    // da caçada contra o relógio do servidor.
    this._broadcast({
      type: S2C.SNAPSHOT,
      t: now,
      matchmakingDeadline: this._matchmakingDeadline,
      matchStartAt: this._matchStartAt,
      phase: this._phase,
      roundId: this._roundId,
      readyCount: this._readyIds.size,
      readyRequired: this.clients.size,
      players,
    });
  }

  _publicState(c) {
    return {
      id: c.id, role: c.role, pos: c.pos, yaw: c.yaw, state: c.state,
      crouched: c.crouched, prone: c.prone, statue: c.statue, moving: c.moving,
      color: c.color, eliminated: c.eliminated,
      isBot: !!c.isBot, name: c.name || null,
      // Munição vai pra TODO mundo (mesmo payload de sempre, sem mensagem nova) —
      // só o próprio Caçador lê os próprios campos em Game.js:_onSnapshot, mas nada
      // impede o Camaleão de um dia mostrar "Caçador tem N tiros restantes" com isto.
      ammo: c.ammo, maxAmmo: c.maxAmmo, infiniteAmmo: c.infiniteAmmo,
    };
  }

  // Só pra WELCOME/_reattach (entrada/reconexão, uma vez) — NUNCA pro
  // SNAPSHOT de todo tick (_tick usa _publicState puro): incluir
  // paintStrokes ali reenviaria o acumulado inteiro 20x/s pra sala inteira,
  // exatamente o custo de banda que a Fase 4 existe pra evitar. Aqui, uma
  // vez por entrada, é só o preço de sincronizar quem já estava pintado.
  _publicStateFull(c) {
    return { ...this._publicState(c), paintStrokes: c.paintStrokes };
  }

  _send(ws, msg) {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(msg));
  }

  _broadcast(msg, exceptId = null) {
    const raw = JSON.stringify(msg);
    for (const c of this.clients.values()) {
      if (c.id === exceptId || !c.connected) continue;
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(raw);
    }
  }
}
