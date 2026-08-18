import { C2S, S2C, TICK_MS } from './net/protocol.js?v=3';

// Cliente WebSocket do modo online (docs/PLANO_MULTIPLAYER.md). Usa o WebSocket
// NATIVO do navegador de propósito — zero dependência nova, importmap intocado,
// preservando "ES Modules puros, sem bundler" (docs/PLANO_VERTICAL_SLICE.md:8).
//
// API mínima: connect() devolve uma Promise que resolve na mensagem `welcome`.
// Handlers são registrados via `net.on(tipo, fn)`. `sendInput`/`sendFire` empacotam
// e mandam; o resto (papel, spawn, snapshots) chega por evento.
export class Net {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.id = null;
    this.role = null;
    this._handlers = new Map();
    this._lastInputSentAt = 0;
    this._lastPayload = null;

    // Keepalive independente do loop de render: `renderer.setAnimationLoop` (rAF) PARA
    // quando a aba fica em segundo plano (padrão em todo navegador, mais agressivo no
    // celular) — sem isto, sendInput() nunca mais é chamado e o servidor derruba o
    // jogador por timeout (CLIENT_TIMEOUT_MS) assim que ele troca de app/aba pra abrir
    // a segunda ponta do teste. setInterval sobrevive em segundo plano (só fica mais
    // lento, ~1/s), então reenvia o ÚLTIMO payload conhecido pra manter a sessão viva.
    this._keepAlive = setInterval(() => {
      if (this.connected && this._lastPayload) this._send({ type: C2S.INPUT, ...this._lastPayload });
    }, 3000);
  }

  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, []);
    this._handlers.get(type).push(fn);
  }

  _emit(type, msg) {
    const fns = this._handlers.get(type);
    if (fns) for (const fn of fns) fn(msg);
  }

  // `joinExtra` carrega config que só importa se o servidor der o papel HUNTER a este
  // socket (hoje: munição — ver protocol.js C2S.JOIN). A sala já atribui papel na
  // conexão, então isto chega DEPOIS do WELCOME — mas sempre antes do primeiro tiro
  // possível, que é a única coisa que lê essa config do lado do servidor.
  connect(joinExtra = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      this.ws = new WebSocket(this.url);

      this.ws.addEventListener('open', () => {
        this._send({ type: C2S.JOIN, ...joinExtra });
      });

      this.ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (_) { return; }

        if (msg.type === S2C.WELCOME) {
          this.id = msg.id;
          this.role = msg.role;
          if (!settled) { settled = true; resolve(msg); }
        }
        this._emit(msg.type, msg);
      });

      this.ws.addEventListener('close', () => {
        clearInterval(this._keepAlive);
        this._emit('_close', {});
        if (!settled) { settled = true; reject(new Error('conexão fechada antes do welcome')); }
      });

      this.ws.addEventListener('error', () => {
        if (!settled) { settled = true; reject(new Error('falha ao conectar ao servidor')); }
      });
    });
  }

  get connected() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  // Limita o envio de input à mesma cadência do servidor (TICK_MS) — mandar a cada
  // frame de render (até 120Hz no celular) desperdiçaria banda sem ganho nenhum,
  // já que o servidor só olha o snapshot mais recente entre um tick e outro.
  sendInput(payload, now = performance.now()) {
    if (!this.connected) return;
    this._lastPayload = payload; // o keepalive reenvia isto se o loop de render parar
    if (now - this._lastInputSentAt < TICK_MS) return;
    this._lastInputSentAt = now;
    this._send({ type: C2S.INPUT, ...payload });
  }

  sendFire(origin, dir) {
    this._send({ type: C2S.FIRE, origin, dir });
  }

  // "Jogar novamente" sem reconectar — ver room.js:_onRevive.
  sendRevive() {
    this._send({ type: C2S.REVIVE });
  }

  _send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }

  close() {
    clearInterval(this._keepAlive);
    if (this.ws) this.ws.close();
  }
}
