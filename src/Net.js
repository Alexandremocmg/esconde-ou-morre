import { C2S, S2C, TICK_MS, RECONNECT_GRACE_MS, PROD_WS_URL, HOST_LOCAL_OU_LAN } from './net/protocol.js?v=6';

// Mesma lógica de escolha de servidor que só existia dentro de Game.js
// (_wsUrl) — movida pra cá (Fase B, Plano 2) porque "Continuar Partida" no
// menu principal precisa dela ANTES de um Game existir, só pra checar se dá
// pra reconectar. Continua com a mesma prioridade: `?ws=` explícito > mesmo
// host/LAN (dev) > PROD_WS_URL.
export function resolveWsUrl() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const override = new URLSearchParams(location.search).get('ws');
  const base = override
    ? (/^wss?:\/\//.test(override) ? override : `${scheme}://${override}`)
    : (HOST_LOCAL_OU_LAN.test(location.hostname) ? `${scheme}://${location.hostname}:8787` : PROD_WS_URL);
  const room = sessionStorage.getItem('eom-room-code');
  if (!room || !/^[A-Z0-9]{4,8}$/.test(room)) return base;
  return `${base}${base.includes('?') ? '&' : '?'}room=${encodeURIComponent(room)}`;
}

// Chave de sessionStorage pra sobreviver a um RELOAD DE VERDADE da página (o
// navegador mata a aba em segundo plano e recarrega do zero — mais comum no
// celular do que parece; foi o que pareceu acontecer nos próprios testes desta
// sessão). sessionStorage é por-aba e some quando a aba fecha de vez, mas
// sobrevive a um reload da MESMA aba — exatamente a garantia que se quer aqui,
// sem inventar um mecanismo novo (mesmo padrão já usado pra eom-body/eom-stage).
const SESSION_KEY = 'eom-online-session';

function loadSession(url) {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.url === url && s.id && s.token ? s : null;
  } catch (_) { return null; }
}
function saveSession(url, id, token) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ url, id, token })); } catch (_) {}
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
}

// "Continuar Partida" (menu principal, Fase B): só precisa saber SE dá pra
// reconectar, não os detalhes — reusa loadSession pra não duplicar a
// validação (mesma aba, mesma URL, id+token presentes). Não garante que o
// servidor ainda segura a vaga (RECONNECT_GRACE_MS pode já ter passado) —
// isso só se sabe tentando; aqui é só uma dica pro menu mostrar o botão.
export function hasResumableSession(url) {
  return !!loadSession(url);
}

// Cliente WebSocket do modo online (docs/PLANO_MULTIPLAYER.md). Usa o WebSocket
// NATIVO do navegador de propósito — zero dependência nova, importmap intocado,
// preservando "ES Modules puros, sem bundler" (docs/PLANO_VERTICAL_SLICE.md:8).
//
// API mínima: connect() devolve uma Promise que resolve na mensagem `welcome`.
// Handlers são registrados via `net.on(tipo, fn)`. `sendInput`/`sendFire` empacotam
// e mandam; o resto (papel, spawn, snapshots) chega por evento.
//
// Reconexão (docs/PLANO_MULTIPLAYER.md §"Débito"): se a conexão cair depois do
// primeiro welcome, este módulo tenta reconectar sozinho (backoff, ver
// _scheduleReconnect) reaproveitando id+token na URL (`?rejoin=id:token`) — o
// servidor decide se reata à sessão antiga ou trata como entrada nova (room.js:
// _reattach). `connect()` só é chamado UMA vez por Game.js; tudo que acontece
// depois (inclusive reconexões) usa o MESMO `Net`, então os handlers registrados
// via `on()` continuam valendo sem precisar re-registrar nada.
export class Net {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.id = null;
    this.role = null;
    this._token = null;
    this._handlers = new Map();
    this._lastInputSentAt = 0;
    this._lastPayload = null;
    this._hadWelcome = false;   // já teve uma sessão de verdade nesta instância?
    this._explicitClose = false; // true só quando close() é chamado de propósito
    this._reconnecting = false;
    this._reconnectAttempt = 0;
    this._disconnectedAt = 0;    // quando a queda ATUAL começou (pra medir contra RECONNECT_GRACE_MS)
    this._reconnectTimer = null;

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

  // Chamado UMA vez por Game.js. `joinExtra` carrega config que só importa se o
  // servidor der o papel HUNTER a este socket (hoje: munição — ver protocol.js
  // C2S.JOIN) — não é reenviada numa reconexão: o servidor já guarda o valor
  // certo na sessão antiga (ver room.js:_reattach, que nunca chama _handleJoin).
  //
  // Se sessionStorage tem uma sessão salva pra esta MESMA url (sobrevivente de
  // um reload de página), tenta retomá-la em vez de entrar como jogador novo —
  // transparente: se o servidor já purgou a sessão (RECONNECT_GRACE_MS
  // esgotado), ele mesmo trata como entrada nova e devolve um id/papel novos.
  connect(joinExtra = {}) {
    const saved = loadSession(this.url);
    const url = saved ? this._withRejoin(this.url, saved.id, saved.token) : this.url;
    return this._open(url, saved ? null : { type: C2S.JOIN, ...joinExtra }, /* isFirstAttempt */ true);
  }

  _withRejoin(url, id, token) {
    return url + (url.includes('?') ? '&' : '?') + `rejoin=${id}:${token}`;
  }

  // Uma tentativa de conexão. `joinMsg` é mandado no 'open' se não-nulo (só na
  // primeira entrada de verdade — nem na retomada por sessionStorage nem numa
  // reconexão automática, que dependem só da identidade na URL). `isFirstAttempt`
  // distingue "isto é o connect() público, devolve uma Promise de verdade" de
  // "isto é uma reconexão automática interna" (ver _scheduleReconnect).
  _open(url, joinMsg, isFirstAttempt) {
    return new Promise((resolve, reject) => {
      let settled = !isFirstAttempt; // reconexão automática não tem Promise pra resolver
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.addEventListener('open', () => {
        if (joinMsg) this._send(joinMsg);
      });

      ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (_) { return; }

        if (msg.type === S2C.WELCOME) {
          this.id = msg.id;
          this.role = msg.role;
          this._token = msg.token;
          saveSession(this.url, msg.id, msg.token);
          const first = !this._hadWelcome;
          this._hadWelcome = true;
          if (!settled) { settled = true; resolve(msg); }
          if (!first) {
            // Reconexão (automática ou via sessionStorage após reload) bem-sucedida.
            this._reconnecting = false;
            this._reconnectAttempt = 0;
            this._emit('_reconnected', msg);
          }
        }
        this._emit(msg.type, msg);
      });

      ws.addEventListener('close', () => {
        if (this._explicitClose) {
          clearInterval(this._keepAlive);
          clearTimeout(this._reconnectTimer);
          if (!settled) { settled = true; reject(new Error('conexão fechada antes do welcome')); }
          this._emit('_close', {});
          return;
        }
        if (!this._hadWelcome) {
          // Nunca chegou a ter uma sessão de verdade — não é "reconexão", é falha
          // de conexão mesmo (servidor fora do ar, sala cheia, etc.). Mesmo
          // comportamento de sempre: rejeita/avisa, sem tentar de novo sozinho.
          if (!settled) { settled = true; reject(new Error('conexão fechada antes do welcome')); }
          this._emit('_close', {});
          return;
        }
        this._scheduleReconnect();
      });

      ws.addEventListener('error', () => {
        if (isFirstAttempt && !settled) { settled = true; reject(new Error('falha ao conectar ao servidor')); }
      });
    });
  }

  // Backoff simples (1s, 2s, 3s, 5s, 5s...) até RECONNECT_GRACE_MS desde a QUEDA
  // (não desde a última tentativa) — espelha o prazo que o servidor usa pra
  // segurar a vaga (room.js:_purgeStale), então cliente e servidor desistem
  // juntos em vez de o cliente insistir numa vaga que o servidor já deu por
  // perdida (ou desistir cedo demais enquanto o servidor ainda seguraria).
  _scheduleReconnect() {
    if (this._reconnecting) return; // 'close' duplicado (ver nota histórica em Net antigo)
    this._reconnecting = true;
    if (!this._disconnectedAt) this._disconnectedAt = Date.now();
    this._emit('_reconnecting', { attempt: this._reconnectAttempt + 1 });

    const elapsed = Date.now() - this._disconnectedAt;
    if (elapsed >= RECONNECT_GRACE_MS) {
      this._giveUp();
      return;
    }

    this._reconnectAttempt++;
    const delay = Math.min(1000 * this._reconnectAttempt, 5000);
    this._reconnectTimer = setTimeout(() => {
      const saved = loadSession(this.url);
      if (!saved) { this._giveUp(); return; } // não deveria acontecer, mas não trava tentando pra sempre
      this._open(this._withRejoin(this.url, saved.id, saved.token), null, false)
        .catch(() => {}); // erro já tratado via 'close'/'error' acima (recursivo em _scheduleReconnect)
    }, delay);
  }

  _giveUp() {
    clearInterval(this._keepAlive);
    clearTimeout(this._reconnectTimer);
    this._reconnecting = false;
    clearSession();
    this._emit('_close', {});
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

  // Fase 4 do pincel 3D — um lote de comandos de traço (ver protocol.js
  // C2S.PAINT/makePaintStroke), mandado automaticamente (ver
  // Game.js:_flushAndSendPaint). NÃO passa por sendInput/TICK_MS: é evento,
  // não estado contínuo — mandar vazio seria só desperdício.
  sendPaintStrokes(strokes) {
    if (!strokes || !strokes.length) return;
    this._send({ type: C2S.PAINT, strokes });
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
    this._explicitClose = true;
    clearInterval(this._keepAlive);
    clearTimeout(this._reconnectTimer);
    clearSession();
    if (this.ws) this.ws.close();
  }
}
