// Joystick virtual em HTML/CSS/Pointer Events, sobreposto ao canvas.
// Aparece onde o dedo toca (dentro da zona) e retorna um vetor normalizado
// { x, y } com y positivo = "para cima/frente".

const MAX_RADIUS = 56; // px de deslocamento máximo do knob

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
    this._moveKnob(dx, dy);
    // y da tela cresce para baixo → invertemos para que "para cima" seja +1
    this.value.x = dx / MAX_RADIUS;
    this.value.y = -dy / MAX_RADIUS;
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
