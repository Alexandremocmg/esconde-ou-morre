import * as THREE from 'three';
import { animationManager } from './AnimationManager.js?v=3';
import { GUN_OFFSET, GUN_ROT } from './Seeker.js?v=4';
import { INTERP_DELAY_MS, GROUND_Y } from './net/protocol.js?v=4';
import { createPaintTexture, stampCircle, strokeBetween } from './UVPaint.js?v=1';

// Altura total do avatar (Player.js: HALF_EXTENT*2, SCALE=0.8). Ficou presa em 0.9
// (o valor de quando Player.js usava SCALE=0.5) por duas rodadas de aumento do jogador
// sem ninguém atualizar aqui — Caçador/Camaleão remotos renderizavam ~40% menores que
// o jogador local. Padronizado de volta pra bater com Player.js.
const HEIGHT = 1.44;

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

  // Mesma interface pública de Player.js/ChameleonTarget.js — deixa o Scanner
  // (Game.js:_updateScanner) tratar alvo local e remoto sem `if` espalhado.
  get position() { return this.group.position; }

  _checkAnimInstance() {
    if (this.animInstance || !animationManager.isLoaded) return;
    const inst = animationManager.createInstance(this.bodyMat, HEIGHT);
    if (inst) {
      inst.group.position.y = -GROUND_Y; // pés em y=0 (ver Player.js/ChameleonTarget.js)
      this.group.add(inst.group);
      this.animInstance = inst;
      // Caçador remoto carrega a arma de água — sem isto, o Camaleão via o
      // Caçador desarmado (mesma pegadinha de Seeker.js: a arma tem que ser
      // pendurada DEPOIS que o modelo animado existe, para achar o osso da mão).
      if (this.role === 'hunter') this._attachBlaster(inst);
      // Fase 4 do pincel 3D: se comandos de traço já chegaram
      // ANTES do modelo animado carregar (applyPaintStrokes criou a textura
      // cedo), aplica agora que o GLB existe.
      if (this.paintTexture) inst.setPaintTexture(this.paintTexture.texture);
    }
  }

  // Fase 4 do pincel 3D — replay dos comandos de traço recebidos
  // via S2C.PLAYER_PAINT (Game.js) ou do acumulado de WELCOME (jogador que
  // já pintava antes deste cliente entrar). Textura criada sob demanda no
  // primeiro traço: a maioria das partidas nunca usa isto, então a maioria
  // dos avatares remotos nunca paga o custo do canvas 512² à toa.
  applyPaintStrokes(strokes) {
    if (!Array.isArray(strokes) || !strokes.length) return;
    if (!this.paintTexture) {
      this.paintTexture = createPaintTexture();
      if (this.animInstance) this.animInstance.setPaintTexture(this.paintTexture.texture);
    }
    const { ctx, texture } = this.paintTexture;
    let last = this._lastRemoteUV || null;
    for (const s of strokes) {
      const uv = { x: s.u, y: s.v };
      const radiusPx = s.r * ctx.canvas.width;
      if (s.d || !last) {
        stampCircle(ctx, uv, s.c, radiusPx);
      } else {
        strokeBetween(ctx, last, uv, s.c, radiusPx);
      }
      last = uv;
    }
    this._lastRemoteUV = last;
    texture.needsUpdate = true;
  }

  // Mesma calibração de Seeker.js:_attachBlaster (GUN_OFFSET/GUN_ROT importados
  // de lá) — o Caçador remoto usa o mesmo GLB e osso da mão.
  _attachBlaster(inst) {
    const arma = animationManager.createBlaster();
    if (!arma) return;
    const blasterGroup = arma.group;

    const mao = inst.handBone;
    if (!mao) {
      inst.group.add(blasterGroup);
      blasterGroup.position.set(0.32, HEIGHT * 0.35, 0.28);
      return;
    }

    mao.add(blasterGroup);
    const s = 1 / (inst.modelScale || 1);
    blasterGroup.scale.multiplyScalar(s);
    blasterGroup.position.set(GUN_OFFSET.x * s, GUN_OFFSET.y * s, GUN_OFFSET.z * s);
    blasterGroup.rotation.set(GUN_ROT.x, GUN_ROT.y, GUN_ROT.z);
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

    // Bidirecional: sem o ramo `false`, um Camaleão revivido ("jogar novamente" —
    // room.js:_onRevive) ficava com `eliminated` travado em true no cliente pra
    // sempre, e a escala nunca voltava de perto-de-zero (só fica cada vez menor em
    // update()) — o avatar sumia da tela do Caçador na rodada seguinte, mesmo com o
    // servidor já sabendo que a partida recomeçou.
    if (latest.eliminated !== this.eliminated) {
      this.eliminated = latest.eliminated;
      if (!this.eliminated) {
        this._fade = 0;
        this.group.scale.setScalar(1);
      }
    }
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
