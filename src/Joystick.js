// Joystick virtual em HTML/CSS/Pointer Events, sobreposto ao canvas.
// Aparece onde o dedo toca (dentro da zona) e retorna um vetor normalizado
// { x, y } com y positivo = "para cima/frente".
import { TUNE } from './Tuning.js?v=1';

const MAX_RADIUS = 56; // px de deslocamento máximo do knob

// Zona morta + curva de resposta + knee de saturação — valores em TUNE
// (Tuning.js), lidos AO VIVO (nunca copiados pra um const de módulo) porque
// o painel de ajuste (⚙️, ?tune=1) precisa poder mudá-los sem reload. DEADZONE
// engole jitter do polegar perto do centro; a magnitude pós-deadzone é
// REESCALADA de volta pra [0..1] (não um clamp-pra-zero-e-pulo, que sentiria
// como um "degrau" no dedo) e elevada a CURVE — fino perto do centro
// (microajuste). KNEE satura a curva em 1.0 antes dos 100% físicos do raio —
// sem isso só um toque EXATAMENTE no limite geométrico dava corrida máxima, e
// um "empurrão até o talo" de verdade num touchscreen raramente bate esse
// limite exato (feedback real depois de jogar: "corrida lenta").

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
    if (rawMag > TUNE.deadzone) {
      const rescaled = (rawMag - TUNE.deadzone) / (1 - TUNE.deadzone); // [deadzone..1] → [0..1] sem salto
      const curveAtKnee = Math.pow(TUNE.knee, TUNE.curve); // recalculado aqui: TUNE muda em runtime, não dá pra cachear
      outMag = Math.min(1, Math.pow(rescaled, TUNE.curve) / curveAtKnee);
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
