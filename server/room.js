// Sala autoritativa — fatia vertical v1 (docs/PLANO_MULTIPLAYER.md).
//
// Autoridade do servidor nesta fase: PAPEL, FASE/TIMER, TIRO e ELIMINAÇÃO. Posição é
// enviada pelo cliente e apenas retransmitida (Débito 1 do plano: movimento é
// forjável até Player.js ganhar um núcleo de simulação sem apresentação/DOM que o
// servidor também possa rodar). Isso é uma escolha registrada, não um descuido.
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
  LOBBY_COUNTDOWN_MS,
  MAX_PAINT_STROKES_PER_MSG,
} from '../src/net/protocol.js';
import { coneCandidates, normalize } from '../src/net/hittest.js';
import { OCCLUDERS_BY_LAYOUT, isOccluded } from '../src/net/occluders.js';

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
    this._matchStartAt = 0;
    this._over = false;
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
  // (Débito 1: movimento também é só confiado, não validado).
  _reattach(ws, { id, token }) {
    const client = this.clients.get(id);
    if (!client || client.connected || client.token !== token) return false;

    client.ws = ws;
    client.connected = true;
    client.lastInputAt = Date.now();

    this._send(ws, {
      type: S2C.WELCOME,
      id: client.id, role: client.role, spawn: client.spawn, layout: this._layout,
      matchDuration: MATCH_DURATION_S, token: client.token, eliminated: client.eliminated,
      matchStartAt: this._matchStartAt,
      players: [...this.clients.values()]
        .filter((c) => c.id !== id && c.connected)
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

    // Sala virou de vez (0 clientes, nem os em graça de reconexão): reabre a
    // escolha de mapa — mesma rotação determinística de Game.js, mas só CONSULTADA
    // aqui na formação (ver comentário no construtor sobre por que não a cada tick).
    if (holders.length === 0) this._layout = onlineLayoutFor();

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
    if (connectedBefore === 0) this._over = false; // sala virou de vez: destrava pra um novo ciclo

    const chameleonsConnectedBefore = holders.filter(
      (c) => c.connected && c.role === ROLE.CHAMELEON,
    ).length;
    if (role === ROLE.CHAMELEON && chameleonsConnectedBefore === 0) {
      // Só o 1º CAMALEÃO de verdade arma a contagem — não o Caçador sozinho
      // (docs/PLANO_LOBBY_MULTIPLAYER.md §3.3). Antes disso o Caçador podia ficar
      // esperando na sala vazia queimando os 180s da partida à toa; agora o hint
      // "Sozinho na sala" (Game.js) cobre essa espera sem custar tempo de partida.
      //
      // Lobby/matchmaking (docs/PLANO_LOBBY_COUNTDOWN.md): `_matchStartAt` vira um
      // timestamp FUTURO (`+ LOBBY_COUNTDOWN_MS`) em vez de instantâneo — dá uma
      // janela pra mais gente entrar pelo link compartilhado antes do Caçador poder
      // atirar. `_tick()` calcula `elapsed` contra este mesmo campo; enquanto ele
      // está no futuro, `elapsed` é negativo e o fim-por-tempo nunca dispara sozinho
      // — nenhuma mudança necessária lá. `_handleFire` ganha o gate correspondente.
      this._matchStartAt = Date.now() + LOBBY_COUNTDOWN_MS;
    }

    // Sala cheia ANTES da contagem acabar: pula direto pro início — com todo mundo já
    // presente não faz sentido esperar o resto dos 12s à toa (docs/PLANO_LOBBY_COUNTDOWN.md).
    if (this._matchStartAt > Date.now() && this.clients.size === ROOM_CAPACITY) {
      this._matchStartAt = Date.now();
    }

    this._send(ws, {
      type: S2C.WELCOME,
      id, role, spawn, layout: this._layout,
      matchDuration: MATCH_DURATION_S, token, eliminated: client.eliminated, // sempre false aqui (join novo), por simetria com _reattach
      matchStartAt: this._matchStartAt,
      players: [...this.clients.values()]
        .filter((c) => c.id !== id && c.connected)
        .map((c) => this._publicStateFull(c)),
    });

    this._broadcast({ type: S2C.PLAYER_JOIN, player: this._publicState(client) }, id);
    console.log(`[room] entrou ${id} como ${role} (${this.clients.size} na sala)`);

    ws.on('message', (raw) => this._onMessage(client, raw));
    ws.on('close', () => this._onDisconnect(client));
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
      if (this.clients.size === 0) this._over = false; // sala esvaziou: próxima entrada reinicia
    }
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
    client.infiniteAmmo = !!msg.infiniteAmmo;
    const ammo = Number(msg.ammo);
    client.maxAmmo = Number.isFinite(ammo) && ammo > 0 ? Math.floor(ammo) : HUNTER_AMMO_DEFAULT;
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
    client.eliminated = false;
    if (this._over) {
      this._over = false;
      // Proposital: revanche instantânea, SEM a contagem de lobby
      // (docs/PLANO_LOBBY_COUNTDOWN.md) — quem já estava jogando junto não precisa
      // esperar de novo, a contagem só faz sentido pra uma sala se formando do zero.
      // Não "consertar" isto pra `Date.now() + LOBBY_COUNTDOWN_MS` sem querer.
      this._matchStartAt = Date.now();
      for (const c of this.clients.values()) {
        c.eliminated = false;
        c.ammo = c.maxAmmo; // só tem efeito real pra quem é HUNTER — o resto nunca lê o próprio
      }
    }
  }

  _applyInput(client, msg) {
    // O servidor ainda não simula a colisão completa, mas rejeita valores que não
    // podem representar um jogador no mapa. Isso impede teleporte para coordenadas
    // absurdas e mantém a autoridade futura compatível com o formato atual.
    const p = msg.p;
    if (!Array.isArray(p) || p.length !== 3 || p.some((n) => !Number.isFinite(n))) return;
    if (p.some((n) => Math.abs(n) > 200)) return;
    client.pos = { x: p[0], y: p[1], z: p[2] };
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
    // `!this._matchStartAt`: sala não formada ainda (Caçador sozinho). `now <
    // this._matchStartAt`: contagem de lobby ainda rolando (docs/PLANO_LOBBY_COUNTDOWN.md)
    // — mesmo campo, os dois estados possíveis antes da partida ficar ativa de verdade.
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

    const candidates = [...this.clients.values()]
      .filter((c) => c.role === ROLE.CHAMELEON && c.connected && !c.eliminated)
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
      const target = this.clients.get(best.id);
      if (target) target.eliminated = true;
      this._broadcast({ type: S2C.PLAYER_HIT, targetId: best.id, hunterId: client.id });

      const remaining = [...this.clients.values()]
        .filter((c) => c.role === ROLE.CHAMELEON && c.connected && !c.eliminated);
      if (remaining.length === 0) this._endMatch(ROLE.HUNTER, 'todos os Camaleões eliminados');
    } else {
      client.nextFireAt = now + HUNTER_MISS_COOLDOWN_MS;
      this._send(client.ws, { type: S2C.FIRE_DENIED, reason: 'miss', nextFireAt: client.nextFireAt });
    }

    // Mesma checagem final de Game.js:fireHunterShot — se o tiro acima já eliminou o
    // último Camaleão, _endMatch(HUNTER,...) já rodou e este _endMatch(CHAMELEON,...)
    // vira um no-op (idempotente por this._over).
    if (!client.infiniteAmmo && client.ammo <= 0) {
      const stillHunting = [...this.clients.values()]
        .some((c) => c.role === ROLE.CHAMELEON && c.connected && !c.eliminated);
      if (stillHunting) this._endMatch(ROLE.CHAMELEON, 'Caçador sem munição');
    }
  }

  _endMatch(winner, reason) {
    if (this._over) return;
    this._over = true;
    this._broadcast({ type: S2C.MATCH_OVER, winner, reason });
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

    if (!this._over && this._matchStartAt && this.clients.size > 0) {
      const elapsed = (now - this._matchStartAt) / 1000;
      if (elapsed >= MATCH_DURATION_S) {
        const chameleonsAlive = [...this.clients.values()]
          .some((c) => c.role === ROLE.CHAMELEON && c.connected && !c.eliminated);
        this._endMatch(chameleonsAlive ? ROLE.CHAMELEON : ROLE.HUNTER, 'tempo esgotado');
      }
    }

    if (this.clients.size === 0) return;
    const players = [...this.clients.values()]
      .filter((c) => c.connected)
      .map((c) => this._publicState(c));
    // matchStartAt junto de `t` (hora do servidor) deixa o cliente calcular "quantos
    // segundos faltam" contra o RELÓGIO DO SERVIDOR, sem depender do Date.now() local
    // (que pode estar dessincronizado) — docs/PLANO_LOBBY_COUNTDOWN.md.
    this._broadcast({ type: S2C.SNAPSHOT, t: now, matchStartAt: this._matchStartAt, players });
  }

  _publicState(c) {
    return {
      id: c.id, role: c.role, pos: c.pos, yaw: c.yaw, state: c.state,
      crouched: c.crouched, prone: c.prone, statue: c.statue, moving: c.moving,
      color: c.color, eliminated: c.eliminated,
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
