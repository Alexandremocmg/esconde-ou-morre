import * as THREE from 'three';

// Roda de cor HSV (Fase 5b) — ajuste fino manual do disfarce por cima do
// conta-gotas. Ângulo = matiz (H), raio = saturação (S); um slider define o
// brilho (V). A cor escolhida é entregue ao Game em ESPAÇO sRGB (setRGB com
// SRGBColorSpace), o mesmo espaço em que as superfícies guardam a cor — então a
// métrica de camuflagem (Player.isCamouflaged, que compara em sRGB) permanece
// coerente. 100% procedural (canvas), sem assets.

const SIZE = 150; // lado do canvas da roda (px)

// HSV → RGB (0–255). h em graus (0–360); s,v em 0–1.
function hsv2rgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// RGB (0–255) → HSV. Usado para semear a roda com a cor recém-sugada.
function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

export class ColorPicker {
  constructor({ onChange } = {}) {
    this.onChange = onChange;
    this.panel = document.getElementById('palette-panel');
    this.canvas = document.getElementById('pal-wheel');
    this.marker = document.getElementById('pal-marker');
    this.slider = document.getElementById('pal-value');
    this.swatch = document.getElementById('pal-swatch');
    this.open = false;
    this.h = 0; this.s = 0; this.v = 1;
    this._color = new THREE.Color();
    if (!this.panel || !this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    // Arrasto na roda → matiz/saturação. stopPropagation p/ o look-zone atrás não
    // interpretar como giro de câmera.
    let dragging = false;
    const pick = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const dx = e.clientX - rect.left - rect.width / 2;
      const dy = e.clientY - rect.top - rect.height / 2;
      const r = rect.width / 2;
      this.h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      this.s = Math.min(1, Math.hypot(dx, dy) / r);
      this._apply();
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      dragging = true;
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
      pick(e);
    }, { passive: false });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      e.preventDefault(); pick(e);
    }, { passive: false });
    const end = () => { dragging = false; };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);

    this.slider.addEventListener('input', () => {
      this.v = (+this.slider.value) / 100;
      this._draw();
      this._apply();
    });
    // O painel inteiro engole toques (não vazam para o look-zone / joystick).
    this.panel.addEventListener('pointerdown', (e) => e.stopPropagation(), { passive: false });
    const close = document.getElementById('pal-close');
    if (close) close.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); this.hide();
    }, { passive: false });
  }

  // Redesenha a roda para o brilho (V) atual. Chamado ao abrir e ao mexer no slider
  // (não por frame): o custo de 150² px é irrelevante fora do loop.
  _draw() {
    const ctx = this.ctx, size = SIZE, r = size / 2;
    const img = ctx.createImageData(size, size), d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - r + 0.5, dy = y - r + 0.5;
        const dist = Math.hypot(dx, dy), i = (y * size + x) * 4;
        if (dist > r) { d[i + 3] = 0; continue; }
        const h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        const s = Math.min(1, dist / r);
        const c = hsv2rgb(h, s, this.v);
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // Converte HSV atual → THREE.Color (sRGB), posiciona o marcador e notifica.
  _apply() {
    const [r, g, b] = hsv2rgb(this.h, this.s, this.v);
    this._color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    if (this.marker) {
      const rad = this.s * (SIZE / 2);
      const ang = this.h * Math.PI / 180;
      this.marker.style.left = (SIZE / 2 + Math.cos(ang) * rad) + 'px';
      this.marker.style.top = (SIZE / 2 + Math.sin(ang) * rad) + 'px';
    }
    const hex = '#' + this._color.getHexString(THREE.SRGBColorSpace);
    if (this.marker) this.marker.style.background = hex;
    if (this.swatch) this.swatch.style.background = hex;
    if (this.onChange) this.onChange(this._color);
  }

  // Abre semeando a roda com a cor atual do disfarce (a que o conta-gotas sugou).
  show(seedColor) {
    if (!this.panel) return;
    if (seedColor) {
      const hex = seedColor.getHexString(THREE.SRGBColorSpace);
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const [h, s, v] = rgb2hsv(r, g, b);
      this.h = h; this.s = s; this.v = v;
      if (this.slider) this.slider.value = String(Math.round(v * 100));
    }
    this._draw();
    this._apply();
    this.panel.classList.remove('hidden');
    this.open = true;
  }

  hide() { if (this.panel) this.panel.classList.add('hidden'); this.open = false; }

  toggle(seedColor) { this.open ? this.hide() : this.show(seedColor); }
}
