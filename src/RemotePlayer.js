import * as THREE from 'three';
import { animationManager } from './AnimationManager.js';
import { INTERP_DELAY_MS, GROUND_Y } from './net/protocol.js';

const HEIGHT = 0.9; // altura total do avatar (Player.js: HALF_EXTENT*2)

// Avatar de um jogador REMOTO (modo online — docs/PLANO_MULTIPLAYER.md). Nunca roda
// física própria: só interpola os snapshots que chegam do servidor (buffer de
// INTERP_DELAY_MS, spec §1) e escolhe a animação a partir do estado recebido — nunca
// sincroniza o NOME do clipe pela rede, ele já é derivado do estado em Player.js.
export class RemotePlayer {
  constructor(scene, id, role, spawn) {
    this.id = id;
    this.role = role;
    this.eliminated = false;
    this._fade = 0;

    // `spawn.y`/snapshots.pos.y JÁ SÃO a altura do CENTRO da cápsula (é o que
    // Player.position manda pela rede — ver protocol.js) — nada a somar aqui. Bug real
    // já corrigido: somar GROUND_Y de novo fazia os avatares remotos flutuarem 2×
    // GROUND_Y acima do chão (visível/quebrado sobretudo em escadas, onde o Y varia).
    this.group = new THREE.Group();
    this.group.position.set(spawn.x, spawn.y, spawn.z);
    scene.add(this.group);

    this.bodyMat = new THREE.MeshToonMaterial({ color: 0xeef0f2 });
    this.animInstance = null;
    this._checkAnimInstance();

    // Buffer de snapshots {t, pos, yaw, ...} — mesmo padrão de entity interpolation
    // da spec §1: renderiza sempre ATRASADO em INTERP_DELAY_MS para ter dois pontos
    // entre os quais interpolar, mesmo se um pacote atrasar.
    this._buffer = [];
    this.pushSnapshot({ pos: spawn, yaw: 0, state: 'grounded', crouched: false, prone: false, statue: false, moving: false, color: [0xeef0f2, 0xeef0f2], eliminated: false }, Date.now());
  }

  _checkAnimInstance() {
    if (this.animInstance || !animationManager.isLoaded) return;
    const inst = animationManager.createInstance(this.bodyMat, HEIGHT);
    if (inst) {
      inst.group.position.y = -GROUND_Y; // pés em y=0 (ver Player.js/ChameleonTarget.js)
      this.group.add(inst.group);
      this.animInstance = inst;
    }
  }

  // Chamado a cada snapshot recebido do servidor (protocol.js S2C.SNAPSHOT).
  pushSnapshot(s, tServer) {
    this._buffer.push({ t: tServer, ...s });
    // Mantém só o necessário para interpolar (uns 2s de histórico é sobra generosa).
    const cutoff = tServer - 2000;
    while (this._buffer.length > 2 && this._buffer[0].t < cutoff) this._buffer.shift();
  }

  update(dt) {
    this._checkAnimInstance();
    this._interpolate();

    if (this.eliminated) {
      this._fade = Math.min(1, this._fade + dt * 1.5);
      const s = Math.max(0.001, 1 - this._fade);
      this.group.scale.setScalar(s);
    }

    if (this.animInstance) this.animInstance.update(dt);
  }

  // Interpola entre os dois snapshots que cercam "agora - INTERP_DELAY_MS". Sem
  // histórico suficiente (acabou de entrar), usa o mais recente sem interpolar.
  _interpolate() {
    const buf = this._buffer;
    if (buf.length === 0) return;
    const renderT = Date.now() - INTERP_DELAY_MS;

    let a = buf[0], b = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].t <= renderT && buf[i + 1].t >= renderT) {
        a = buf[i]; b = buf[i + 1];
        break;
      }
    }
    const span = b.t - a.t;
    const k = span > 0 ? THREE.MathUtils.clamp((renderT - a.t) / span, 0, 1) : 1;

    const x = THREE.MathUtils.lerp(a.pos.x, b.pos.x, k);
    const y = THREE.MathUtils.lerp(a.pos.y, b.pos.y, k);
    const z = THREE.MathUtils.lerp(a.pos.z, b.pos.z, k);
    this.group.position.set(x, y, z); // pos.y já é a altura do centro da cápsula — ver GROUND_Y acima

    // Yaw: menor caminho angular (evita girar pelo lado longo ao cruzar ±π).
    let dyaw = b.yaw - a.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.group.rotation.y = a.yaw + dyaw * k;

    const latest = b;
    if (this.animInstance) {
      const clip = this._pickClip(latest);
      this.animInstance.playAnimation(clip);
      this._tmpColor = this._tmpColor || new THREE.Color();
      this._tmpColor.setHex(latest.color[0]);
      this.animInstance.setColor(this._tmpColor);
    }

    if (latest.eliminated && !this.eliminated) this.eliminated = true;
  }

  // Mesma árvore de decisão de Player.js:439-454, adaptada ao que o fio carrega (sem
  // velocity/isJumping — pulo remoto fica pra depois, é só cosmético).
  _pickClip(s) {
    if (s.state === 'latched') return s.moving ? 'climb' : 'hide';
    if (s.prone) return 'prone';
    if (s.crouched) return 'crouch';
    if (s.moving) {
      return this.role === 'hunter' && this.animInstance.actions['rifleRun'] ? 'rifleRun' : 'run';
    }
    return 'idle';
  }

  destroy() {
    if (this.group.parent) this.group.parent.remove(this.group);
    if (this.animInstance) this.animInstance.destroy();
  }
}
