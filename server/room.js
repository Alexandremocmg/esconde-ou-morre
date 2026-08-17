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
} from '../src/net/protocol.js';
import { coneCandidates, normalize } from '../src/net/hittest.js';

const MAX_PLAYERS = 2; // v1: sala fixa de 1 Caçador + 1 Camaleão (spec §4 fica pra depois)

// Pontos de spawn copiados de Level.js (layout 1: this.spawn.set(-6, 0, 8)), com o 2º
// jogador deslocado alguns metros no mesmo cômodo aberto (canto SW). `y: GROUND_Y`, não
// 0 — Player.position (o que os snapshots reais vão carregar) é a altura do CENTRO da
// cápsula, não a altura do chão; o spawn sintético precisa começar consistente com isso
// (bug real já corrigido: avatares remotos flutuavam 2×GROUND_Y — ver protocol.js).
const SPAWNS = {
  [ROLE.HUNTER]: { x: -6, y: GROUND_Y, z: 8 },
  [ROLE.CHAMELEON]: { x: -3, y: GROUND_Y, z: 8 },
};

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
  addClient(ws) {
    const active = [...this.clients.values()].filter((c) => c.connected);
    if (active.length >= MAX_PLAYERS) {
      this._send(ws, { type: S2C.MATCH_OVER, winner: null, reason: 'sala cheia' });
      ws.close(4001, 'sala cheia');
      return;
    }

    const id = randomUUID();
    const takenRoles = new Set(active.map((c) => c.role));
    const role = takenRoles.has(ROLE.HUNTER) ? ROLE.CHAMELEON : ROLE.HUNTER;
    const spawn = SPAWNS[role];

    const client = {
      id, ws, role, connected: true,
      pos: { ...spawn }, yaw: 0, state: 'grounded',
      crouched: false, prone: false, statue: false, moving: false,
      color: [0xeef0f2, 0xeef0f2],
      eliminated: false,
      nextFireAt: 0,
      lastInputAt: Date.now(),
    };
    this.clients.set(id, client);

    if (active.length === 0) {
      // Primeiro jogador da sala: começa a partida (v1 não tem lobby/contagem — spec
      // §4 fica para uma próxima fase, ver plano).
      this._matchStartAt = Date.now();
      this._over = false;
    }

    this._send(ws, {
      type: S2C.WELCOME,
      id, role, spawn, layout: FIXED_LAYOUT,
      matchDuration: MATCH_DURATION_S,
      players: [...this.clients.values()]
        .filter((c) => c.id !== id && c.connected)
        .map((c) => this._publicState(c)),
    });

    this._broadcast({ type: S2C.PLAYER_JOIN, player: this._publicState(client) }, id);
    console.log(`[room] entrou ${id} como ${role} (${this.clients.size} na sala)`);

    ws.on('message', (raw) => this._onMessage(client, raw));
    ws.on('close', () => this._onLeave(client));
  }

  _onLeave(client) {
    client.connected = false;
    this.clients.delete(client.id);
    this._broadcast({ type: S2C.PLAYER_LEAVE, id: client.id });
    console.log(`[room] saiu ${client.id} (${this.clients.size} na sala)`);
    if (this.clients.size === 0) this._over = false; // sala esvaziou: próxima entrada reinicia
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
    }
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
      this._matchStartAt = Date.now();
      for (const c of this.clients.values()) c.eliminated = false;
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
    if (this._over || client.role !== ROLE.HUNTER || client.eliminated) return;

    const now = Date.now();
    if (now < client.nextFireAt) return; // spam silenciosamente ignorado (cooldown já corre no cliente)

    const origin = msg.origin, dirIn = msg.dir;
    if (!origin || !dirIn) return;
    const dir = normalize(dirIn);

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
    for (const c of this.clients.values()) {
      if (c.connected && now - c.lastInputAt > CLIENT_TIMEOUT_MS) {
        c.connected = false;
        try { c.ws.terminate(); } catch (_) {}
        this._onLeave(c);
      }
    }

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
    this._broadcast({ type: S2C.SNAPSHOT, t: now, players });
  }

  _publicState(c) {
    return {
      id: c.id, role: c.role, pos: c.pos, yaw: c.yaw, state: c.state,
      crouched: c.crouched, prone: c.prone, statue: c.statue, moving: c.moving,
      color: c.color, eliminated: c.eliminated,
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
