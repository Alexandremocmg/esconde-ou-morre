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

  // Bip com varredura de frequência (para pops/bolhas). de→para em `dur`.
  _sweep(from, to, dur, gain = 0.3, type = 'sine') {
    if (!this.enabled) return;
    this._ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Clique alegre ao GRUDAR: pop curto + harmônico.
  latch() {
    this._beep(420, 0.05, 0.20, 'triangle');
    setTimeout(() => this._beep(660, 0.04, 0.14, 'triangle'), 20);
  }

  // Pop/bolha ao amostrar cor (conta-gotas): varredura ascendente + sparkle.
  paint() {
    this._sweep(300, 1000, 0.13, 0.24, 'sine');
    setTimeout(() => this._beep(1320, 0.05, 0.12, 'triangle'), 90);
  }

  // Sucesso de CAMUFLAGEM: chime curto e satisfatório (dois tons em terça maior).
  camo() {
    this._beep(880, 0.10, 0.20, 'sine');
    setTimeout(() => this._beep(1175, 0.14, 0.18, 'sine'), 70);
  }

  // "Uh-oh" ao ser DETECTADO: duas notas descendentes (cartoon, sem terror).
  alert() {
    this._beep(760, 0.10, 0.22, 'triangle');
    setTimeout(() => this._beep(610, 0.12, 0.22, 'triangle'), 110);
  }

  // Tensão da PERSEGUIÇÃO (cadência controlada pelo Game): "tick" leve de
  // woodblock que sobe de tom com a intensidade — animado, não sinistro.
  heartbeat(intensity = 0.5) {
    const g = 0.12 + 0.20 * intensity;
    this._beep(300 + 320 * intensity, 0.06, g, 'triangle');
  }

  // Contagem regressiva para a vitória (sobe de tom a cada segundo).
  countdown(secondsLeft) {
    const freq = 660 + (5 - secondsLeft) * 80; // 5→660Hz ... 1→980Hz
    this._beep(freq, 0.11, 0.26, 'triangle');
  }

  // VITÓRIA: arpejo maior ascendente + oitava de brilho no fim.
  win() {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => this._beep(f, 0.20, 0.28, 'triangle'), i * 100));
    setTimeout(() => this._beep(1568, 0.28, 0.22, 'sine'), 460);
  }

  // DERROTA (pego): "sad trombone" cômico — notas descendentes com leve bend.
  caught() {
    const notes = [392, 349, 311, 262]; // Sol Fá Mib Dó
    notes.forEach((f, i) =>
      setTimeout(() => this._sweep(f, f * 0.94, 0.28, 0.3, 'sawtooth'), i * 180));
  }

  // DISPARO DE ÁGUA DO CAÇADOR: ruído branco de alta pressão com varredura descendente.
  waterBlast() {
    this._sweep(850, 220, 0.18, 0.35, 'sawtooth');
    setTimeout(() => this._sweep(1200, 300, 0.14, 0.25, 'triangle'), 30);
  }

  // SEM MUNIÇÃO (CLICK SECO): "tick" metálico de gatilho sem água.
  emptyClick() {
    this._beep(180, 0.03, 0.3, 'square');
  }

  // RESPINGO DE ÁGUA / LAVAGEM DE TINTA: som de borrifo líquido.
  waterSplash() {
    this._sweep(400, 950, 0.08, 0.20, 'sine');
  }
}
