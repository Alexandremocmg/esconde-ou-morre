// Joystick virtual em HTML/CSS/Pointer Events, sobreposto ao canvas.
// Aparece onde o dedo toca (dentro da zona) e retorna um vetor normalizado
// { x, y } com y positivo = "para cima/frente".

const MAX_RADIUS = 56; // px de deslocamento máximo do knob

// Zona morta + curva de resposta: antes a leitura era 100% linear (qualquer
// toque acima de ~1% de deflexão em Player.js já virava corrida máxima — não
// havia controle analógico nenhum). DEADZONE engole jitter do polegar perto do
// centro; a magnitude pós-deadzone é REESCALADA de volta pra [0..1] (não um
// clamp-pra-zero-e-pulo, que sentiria como um "degrau" no dedo) e elevada a
// CURVE — fino perto do centro (microajuste), converge rápido perto do máximo.
// Full-tilt sempre dá magnitude exatamente 1 (rescaled=1 → 1^CURVE=1), então o
// teto de velocidade (MOVE_SPEED, Player.js) não muda, só a rampa até ele.
const DEADZONE = 0.12;
const CURVE = 2;

// KNEE: sem isto, só um toque EXATAMENTE nos 56px de MAX_RADIUS dava corrida
// máxima — na prática um "empurrão até o talo" de verdade num touchscreen
// raramente bate o limite geométrico exato (a 90% de deflexão física, a
// curva pura só dava ~79% de velocidade — sentia como "corrida lenta",
// feedback real depois de jogar). A partir de KNEE (85% do curso PÓS-
// deadzone) a curva satura em 1 — "perto da borda" já é sprint completo,
// sem precisar do pixel exato. CURVE_AT_KNEE reescala a mesma curva pra
// caber antes do knee; a forma pra controle fino perto do centro (< 50%)
// muda pouco.
const KNEE = 0.85;
const CURVE_AT_KNEE = Math.pow(KNEE, CURVE);

export class Joystick {
  constructor() {
    this.zone = document.getElementById('joystick-zone');
    this.base = document.getElementById('joystick-base');
    this.knob = document.getElementById('joystick-knob');

    this.pointerId = null;
    this.origin = { x: 0, y: 0 };
    this.value = { x: 0, y: 0 }; // [-1, 1]

    this.zone.addEventListener('pointerdown', this._onDown, { passive: false });
    window.addEventListener('pointermove', this._onMove, { passive: false });
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
  }

  get active() {
    return this.pointerId !== null;
  }

  _onDown = (e) => {
    if (this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.origin.x = e.clientX;
    this.origin.y = e.clientY;
    this.base.style.left = `${e.clientX}px`;
    this.base.style.top = `${e.clientY}px`;
    this.base.classList.add('active');
    this._moveKnob(0, 0);
    if (navigator.vibrate) try { navigator.vibrate(10); } catch (_) {}
  };

  _onMove = (e) => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    let dx = e.clientX - this.origin.x;
    let dy = e.clientY - this.origin.y;
    const dist = Math.hypot(dx, dy);
    if (dist > MAX_RADIUS) {
      dx = (dx / dist) * MAX_RADIUS;
      dy = (dy / dist) * MAX_RADIUS;
    }
    // O botão visual acompanha o dedo 1:1, SEMPRE cru — só o `value` lógico que
    // o jogo consome ganha deadzone/curva (ver constantes no topo do arquivo).
    this._moveKnob(dx, dy);

    const rawMag = dist > MAX_RADIUS ? 1 : dist / MAX_RADIUS;
    let outMag = 0;
    if (rawMag > DEADZONE) {
      const rescaled = (rawMag - DEADZONE) / (1 - DEADZONE); // [DEADZONE..1] → [0..1] sem salto
      outMag = Math.min(1, Math.pow(rescaled, CURVE) / CURVE_AT_KNEE);
    }
    const dirX = rawMag > 1e-4 ? dx / dist : 0;
    const dirY = rawMag > 1e-4 ? dy / dist : 0;
    // y da tela cresce para baixo → invertemos para que "para cima" seja +1
    this.value.x = dirX * outMag;
    this.value.y = -dirY * outMag;
  };

  _onUp = (e) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.value.x = 0;
    this.value.y = 0;
    this.base.classList.remove('active');
    this._moveKnob(0, 0);
  };

  _moveKnob(dx, dy) {
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}
