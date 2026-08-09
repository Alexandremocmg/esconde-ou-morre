// Áudio procedural simples via Web Audio API — sem assets externos.
// Um oscilador por bip, com envelope curto. O contexto só arranca após um
// gesto do usuário (chamamos resume() no start do jogo).
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }

  _ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  // Deve ser chamado dentro de um gesto do usuário (clique de iniciar).
  resume() {
    this._ensure();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // Bip genérico com envelope.
  _beep(freq, dur, gain = 0.3, type = 'sine') {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Batida de tensão (perigo de ser pego). intensity 0..1 controla volume/altura.
  heartbeat(intensity = 0.5) {
    const g = 0.18 + 0.32 * intensity;
    this._beep(70 + 30 * intensity, 0.16, g, 'sine');
  }

  // Contagem regressiva para a vitória (sobe de tom a cada segundo).
  countdown(secondsLeft) {
    const freq = 620 + (5 - secondsLeft) * 70; // 5→620Hz ... 1→900Hz
    this._beep(freq, 0.12, 0.28, 'triangle');
  }

  win() {
    // Pequeno arpejo ascendente.
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => this._beep(f, 0.22, 0.3, 'triangle'), i * 110));
  }

  caught() {
    this._beep(180, 0.5, 0.35, 'sawtooth');
    setTimeout(() => this._beep(90, 0.6, 0.3, 'sawtooth'), 90);
  }
}
