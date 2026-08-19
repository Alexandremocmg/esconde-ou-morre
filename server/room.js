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
  FIXED_LAYOUT,
  GROUND_Y,
  HUNTER_AMMO_DEFAULT,
  MAX_CHAMELEONS,
  LOBBY_COUNTDOWN_MS,
} from '../src/net/protocol.js';
import { coneCandidates, normalize } from '../src/net/hittest.js';

// Lobby maior (docs/PLANO_LOBBY_MULTIPLAYER.md): a sala inteira é 1 Caçador +
// MAX_CHAMELEONS Camaleões — a atribuição de papel (mais abaixo) já dava HUNTER só pro
// 1º e CHAMELEON pra todo o resto, então só o limite de capacidade precisava mudar.
const ROOM_CAPACITY = 1 + MAX_CHAMELEONS;

// Ponto de spawn do Caçador copiado de Level.js (layout 1: this.spawn.set(-6, 0, 8)).
// `y: GROUND_Y`, não 0 — Player.position (o que os snapshots reais vão carregar) é a
// altura do CENTRO da cápsula, não a altura do chão; o spawn sintético precisa começar
// consistente com isso (bug real já corrigido: avatares remotos flutuavam 2×GROUND_Y —
// ver protocol.js).
const HUNTER_SPAWN = { x: -6, y: GROUND_Y, z: 8 };

// Base dos spawns dos Camaleões: mesmo canto SW aberto de antes (era um ponto único fixo
// quando a sala só tinha 1 Camaleão). Com N Camaleões, cada um pega um ponto num anel ao
// redor desta base pra não nascer empilhado em cima dos outros — ver `_chameleonSpawn`.
const CHAMELEON_SPAWN_BASE = { x: -3, z: 8 };
const CHAMELEON_SPAWN_RADIUS = 2.2; // ainda dentro do cômodo aberto, testado sem colisão

// `index` é a ordem de entrada entre os Camaleões (0, 1, 2...), não um id — divide o
// círculo em MAX_CHAMELEONS fatias iguais. Sem validação contra geometria (Débito 1 do
// plano original): o controlador do jogador já resolve colisão a partir do 1º frame,
// igual sempre aconteceu com o ponto único.
function _chameleonSpawn(index) {
  const angle = (index * 2 * Math.PI) / MAX_CHAMELEONS;
  return {
    x: CHAMELEON_SPAWN_BASE.x + CHAMELEON_SPAWN_RADIUS * Math.cos(angle),
    y: GROUND_Y,
    z: CHAMELEON_SPAWN_BASE.z + CHAMELEON_SPAWN_RADIUS * Math.sin(angle),
  };
}

export class Room {
  constructor() {
    this.clients = new Map(); // id -> ClientState
    this._matchStartAt = 0;
    this._over = false;
    this._interval = null;
  }

  start() {
    if (this._interval) return;
    this._interval = setInterval(() => this._tick(), TICK_MS);
    console.log(`[room] tick loop a cada ${TICK_MS.toFixed(1)}ms`);
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
      id: client.id, role: client.role, spawn: client.spawn, layout: FIXED_LAYOUT,
      matchDuration: MATCH_DURATION_S, token: client.token, eliminated: client.eliminated,
      matchStartAt: this._matchStartAt,
      players: [...this.clients.values()]
        .filter((c) => c.id !== id && c.connected)
        .map((c) => this._publicState(c)),
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

    const id = randomUUID();
    const token = randomUUID();
    const takenRoles = new Set(holders.map((c) => c.role));
    const role = takenRoles.has(ROLE.HUNTER) ? ROLE.CHAMELEON : ROLE.HUNTER;
    // Índice de entrada ENTRE os Camaleões (0, 1, 2...) — decide a fatia do anel de
    // spawn deste (`_chameleonSpawn`). Irrelevante pro Caçador, que tem ponto fixo.
    const chameleonIndex = holders.filter((c) => c.role === ROLE.CHAMELEON).length;
    const spawn = role === ROLE.HUNTER ? HUNTER_SPAWN : _chameleonSpawn(chameleonIndex);

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
      // Munição: valores por padrão, corrigidos por _handleJoin() assim que o JOIN
      // chegar (sempre antes do primeiro tiro possível — ver protocol.js C2S.JOIN).
      // Só importa pra quem é HUNTER; o Camaleão nunca lê os próprios.
      ammo: HUNTER_AMMO_DEFAULT,
      maxAmmo: HUNTER_AMMO_DEFAULT,
      infiniteAmmo: false,
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
      id, role, spawn, layout: FIXED_LAYOUT,
      matchDuration: MATCH_DURATION_S, token, eliminated: client.eliminated, // sempre false aqui (join novo), por simetria com _reattach
      matchStartAt: this._matchStartAt,
      players: [...this.clients.values()]
        .filter((c) => c.id !== id && c.connected)
        .map((c) => this._publicState(c)),
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
    }
  }

  // Chega DEPOIS do WELCOME (o cliente só manda JOIN no evento 'open' do WebSocket,
  // que dispara depois de a Promise de connect() já ter sido criada) mas sempre ANTES
  // do primeiro tiro possível — dá tempo de configurar a munição antes de qualquer
  // _handleFire. Ignorado pra quem virou CHAMELEON: a escolha dele nunca importa,
  // só a de quem o servidor decidiu que é o Caçador.
  _handleJoin(client, msg) {
    if (client.role !== ROLE.HUNTER) return;
    client.infiniteAmmo = !!msg.infiniteAmmo;
    const ammo = Number(msg.ammo);
    client.maxAmmo = Number.isFinite(ammo) && ammo > 0 ? Math.floor(ammo) : HUNTER_AMMO_DEFAULT;
    client.ammo = client.maxAmmo;
  }

  // "Jogar novamente" sem reconectar (Game.js:restartInPlace). Sem isto, `eliminated`
  // e `_over` ficavam presos em true pra sempre (só zeravam quando a sala esvaziava),
  // então: o avatar do Camaleão eliminado continuava sumindo (RemotePlayer.js funde a
  // escala a zero e nunca volta) e o Caçador ficava travado sem poder atirar de novo
  // (_handleFire recusa enquanto _over). Quem clicar primeiro reabre a partida pra
  // ambos — v1 não tem "pronto?" de lobby, então o 1º clique já vale.
  _onRevive(client) {
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
    // Confiança na posição é o Débito 1 documentado no plano — v1 retransmite, não
    // valida. O que o servidor JÁ decide sozinho (papel/tiro/fim de partida) não
    // depende deste método.
    const p = msg.p;
    if (!Array.isArray(p) || p.length !== 3 || p.some((n) => !Number.isFinite(n))) return;
    client.pos = { x: p[0], y: p[1], z: p[2] };
    if (Number.isFinite(msg.y)) client.yaw = msg.y;
    client.state = msg.s === 'latched' ? 'latched' : 'grounded';
    client.crouched = !!msg.c;
    client.prone = !!msg.r;
    client.statue = !!msg.k;
    client.moving = !!msg.m;
    if (Array.isArray(msg.col) && msg.col.length === 2) client.color = msg.col;
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
    const hits = coneCandidates(origin, dir, candidates, {
      range: JET_RANGE,
      halfAngleDeg: HUNTER_AIM_HALF_ANGLE_DEG + AIM_TOLERANCE_DEG,
    });
    const best = hits[0] || null;

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
