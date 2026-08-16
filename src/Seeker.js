import * as THREE from 'three';
import { buildHumanoid, Gait } from './Character.js';
import { toonGradient } from './textures.js';
import { animationManager } from './AnimationManager.js';

// Parâmetros do Caçador
const BODY_R = 0.6;
const BODY_H = 2.2;
const EYE_Y = 1.1;                    // altura dos "olhos" (origem da visão)
const PATROL_SPEED = 3.2;
const CHASE_SPEED = 6.2;
const CHASE_RAMP = 0.5;               // s para acelerar de patrulha até velocidade de caça
const TURN_RATE = 3.5;                // rad/s de giro
const VISION_RANGE = 7.5;             // reescalado p/ a mansão (HALF=12.5); antes 12 (arena 80×80)
const CROUCH_VISION_MULT = 0.6;       // agachado: o Caçador só te enxerga de mais perto (furtividade)
const VISION_HALF_ANGLE = Math.PI / 7; // ~25.7° (cone total ~51°)
// Amostragem de volume: em vez de um único raio ao centro, checa 3 pontos ao
// longo da cápsula do jogador (cabeça/centro/pés). Basta UM ponto visível para
// detectar — cobrir-se atrás de um bloco precisa esconder o corpo todo, não só
// o centro (antes, centro exposto = detecção instantânea, mesmo 90% oculto).
// Deslocamentos Y de cabeça/centro/pés. Reduzidos para acompanhar o jogador
// menor (Player SCALE=0.5 → cápsula ~0.9 de altura). Sem isto, a amostra da
// "cabeça" (+0.7) espetava ~0.25 acima do corpo real e denunciava o jogador
// escondido atrás de props baixos.
const VIEW_SAMPLES = [0.35, 0.0, -0.35];
// Raio de captura: encolhido também. O corpo do Caçador (BODY_R=0.6) não mudou,
// então ~1.1 já cobre "encostou pegou" sem o antigo alcance folgado de 1.5 sobre
// um jogador agora bem menor.
const CATCH_DIST = 1.1;
const CATCH_V_TOL = 1.2;              // banda vertical de captura (|Δy|) — separada da horizontal
const WAYPOINT_REACH = 1.2;
const LOSE_TIME = 0.8;                // s sem alvo válido (camuflado OU fora de vista) até desistir
// Campo de visão VERTICAL próprio (o horizontal é VISION_HALF_ANGLE). Enxerga mais
// para baixo (escada/andar abaixo) do que para cima (impede onisciência do mezanino).
const VERT_UP = 0.50;                 // rad (~29°) para cima
const VERT_DOWN = 0.70;               // rad (~40°) para baixo
// Origem da sonda de chão, acima dos PÉS (não dos olhos): limita o quanto o
// Caçador "sobe" num frame ao degrau de uma escada. Se partisse acima dos olhos,
// ele saltaria para qualquer laje até ~2 m acima — e num ponto com dois níveis
// sobrepostos (2º andar sob a sacada) seria teleportado para o de cima.
const FLOOR_PROBE_UP = 0.5;
const FLOOR_PROBE_DOWN = 2.5;         // alcance da sonda para baixo (descidas/quedas)
const DOWN = new THREE.Vector3(0, -1, 0);

// Desvio simples de obstáculos (whiskers)
const AVOID_PROBE = 2.4;              // alcance de antecipação à frente (m)
const AVOID_MARGIN = 0.6;            // não desvia do próprio alvo (recuo do alcance)
const AVOID_ANGLES = [0.45, 0.9, 1.35]; // rad testados p/ cada lado

// Rotas de fallback (só usadas se o layout não fornecer routes — hoje sempre
// fornece). Reescaladas para a pegada da mansão (HALF=12.5); antes ±12 (arena 80×80).
const WAYPOINTS = [
  new THREE.Vector3(-8, EYE_Y, -8),
  new THREE.Vector3(8, EYE_Y, -8),
  new THREE.Vector3(8, EYE_Y, 8),
  new THREE.Vector3(-8, EYE_Y, 8),
  new THREE.Vector3(0, EYE_Y, 0),
];

export const WAYPOINTS_ALT = [
  new THREE.Vector3(8, EYE_Y, 8),
  new THREE.Vector3(-8, EYE_Y, 8),
  new THREE.Vector3(0, EYE_Y, -2),
  new THREE.Vector3(8, EYE_Y, -8),
  new THREE.Vector3(-8, EYE_Y, -8),
];

const PLAYER_GROUND_SPEED = 7.0;     // teto de justiça: caça nunca alcança no plano
const CHASE_SPEED_CAP = PLAYER_GROUND_SPEED - 0.2;

export class Seeker {
  constructor(scene, level, player, onCaught, opts = {}) {
    this.level = level;
    this.player = player;
    this.onCaught = onCaught;

    // Escalonamento de dificuldade por estágio (Fase 4). A patrulha acelera de
    // leve; a caça sobe mais, mas fica travada abaixo da velocidade do jogador.
    const diff = opts.difficulty || 1;
    this.patrolSpeed = PATROL_SPEED * (1 + (diff - 1) * 0.5);
    this.chaseSpeed = Math.min(CHASE_SPEED_CAP, CHASE_SPEED + (diff - 1) * 3);

    // Rota de patrulha (permite instanciar Caçadores com rotas alternadas).
    this.waypoints = opts.waypoints || WAYPOINTS;
    const bodyColor = opts.color != null ? opts.color : 0xd21f1f;
    this._bodyColor = bodyColor;
    const startY = opts.startY != null ? opts.startY : EYE_Y;
    this._startY = startY;

    this.state = 'patrol'; // 'patrol' | 'chase' | 'caught'
    this.yaw = 0;
    this.wpIndex = 0;
    this.loseTimer = 0;
    this.time = 0;              // relógio local p/ efeitos (pulso do cone)
    this.chaseRamp = 0;         // 0..1: aceleração ao entrar em perseguição
    this.validTarget = false;   // vê o jogador AGORA (na vista e sem camuflagem)
    this.lastKnown = new THREE.Vector3(); // última posição vista do jogador
    this._avoidBias = 1;        // lado preferido ao desviar (evita jitter esquerda/direita)

    this.group = new THREE.Group();
    this.group.position.set(this.waypoints[0].x, startY, this.waypoints[0].z);

    // Grupo visual interno: recebe o bobbing (flutuação) SEM mover a origem da
    // visão (this.group.position), que a IA mantém em EYE_Y de forma determinística.
    this.bodyGroup = new THREE.Group();
    this.group.add(this.bodyGroup);
    this._bobPhase = Math.random() * Math.PI * 2; // dessincroniza 2 Caçadores

    // Corpo: mesmo "art toy" de vinil do jogador, mas em cor distinta (vermelho
    // por padrão; outra cor p/ o 2º Caçador) para ler nitidamente como AMEAÇA.
    // Fosco, sem olhos — só um visor/scanner na cabeça marca a frente.
    const bodyMat = new THREE.MeshToonMaterial({
      color: bodyColor, gradientMap: toonGradient(),
    });
    this.bodyMat = bodyMat;
    const toy = buildHumanoid(bodyMat, BODY_H, { outline: true }); // contorno cel (Fase 3a): ameaça "salta"
    this.toy = toy;
    this.animInstance = null;
    this.bodyGroup.add(toy.group);

    if (animationManager.isLoaded) {
      const inst = animationManager.createInstance(bodyMat, BODY_H, { outline: true });
      if (inst) {
        toy.group.visible = false;
        this.bodyGroup.add(inst.group);
        this.animInstance = inst;
      }
    } else {
      this._checkAnimInstance();
    }

    // Caminhada procedural (mesmo Gait do jogador): pernas/braços balançam e o
    // tronco bobeia — substitui o antigo "flutuar de drone". Fase inicial aleatória
    // dessincroniza os dois Caçadores.
    this.gait = new Gait(toy.rig, { phase: this._bobPhase });
    this._prevPos = this.group.position.clone();

    // Visor emissivo na frente da cabeça (+Z): indica a direção da visão e dá o
    // ar sinistro de um scanner (contraponto aos olhinhos amigáveis do jogador).
    // Vai no tronco (`upper`) para acompanhar o bob/inclinação da caminhada.
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(toy.headR * 1.1, toy.headR * 0.5, 0.18),
      new THREE.MeshToonMaterial({ color: 0x140505, emissive: 0x330000, gradientMap: toonGradient() })
    );
    visor.position.set(0, toy.headY, toy.headR + 0.05);
    toy.rig.upper.add(visor);

    // ARMA DE ÁGUA 3D (Water Blaster / Super Soaker)
    const blasterGroup = new THREE.Group();
    const bodyBarrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.55, 12),
      new THREE.MeshToonMaterial({ color: 0x59c1e8, gradientMap: toonGradient() })
    );
    bodyBarrel.rotation.x = Math.PI / 2;
    blasterGroup.add(bodyBarrel);

    const tankMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.40, 12),
      new THREE.MeshToonMaterial({ color: 0xf2c63c, gradientMap: toonGradient() })
    );
    tankMesh.position.set(0, 0.14, -0.05);
    tankMesh.rotation.x = Math.PI / 2;
    blasterGroup.add(tankMesh);

    const nozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.06, 0.12, 8),
      new THREE.MeshToonMaterial({ color: 0x14181d, gradientMap: toonGradient() })
    );
    nozzle.position.set(0, 0, 0.32);
    nozzle.rotation.x = Math.PI / 2;
    blasterGroup.add(nozzle);

    blasterGroup.position.set(0.32, toy.headY * 0.4, 0.28);
    toy.rig.upper.add(blasterGroup);

    // Cone de visão (visual/debug), apontando +Z a partir dos olhos
    const coneR = Math.tan(VISION_HALF_ANGLE) * VISION_RANGE;
    this.visionMat = new THREE.MeshBasicMaterial({
      color: 0xff5a3c, transparent: true, opacity: 0.12,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(coneR, VISION_RANGE, 24, 1, true),
      this.visionMat
    );
    cone.rotation.x = -Math.PI / 2; // ápice p/ -Z (olhos), base à frente (+Z)
    cone.position.set(0, 0, VISION_RANGE / 2);
    this.bodyGroup.add(cone);

    scene.add(this.group);

    this._ray = new THREE.Raycaster();
    this._toPlayer = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._steerDir = new THREE.Vector3();
    this._avoidL = new THREE.Vector3();
    this._avoidR = new THREE.Vector3();
    this._probe = new THREE.Raycaster();     // sonda de chão (vertical) p/ o Y por andar
    this._probeOrig = new THREE.Vector3();
  }

  reset() {
    this.state = 'patrol';
    this.wpIndex = 0;
    this.loseTimer = 0;
    this.chaseRamp = 0;
    this.validTarget = false;
    const startY = this._startY != null ? this._startY : EYE_Y;
    if (this.waypoints && this.waypoints.length > 0) {
      this.group.position.set(this.waypoints[0].x, startY, this.waypoints[0].z);
    }
    this.yaw = 0;
    this.group.rotation.set(0, 0, 0);
  }

  update(dt) {
    if (this.state === 'caught') return;
    this.time += dt;

    const forward = this._forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const sees = this._canSee(forward);
    const camo = this.player.isCamouflaged();
    const acquired = sees && !camo; // alvo válido: visível e não camuflado

    // Transições de estado
    if (this.state === 'patrol') {
      if (acquired) this._enterChase();
    } else if (this.state === 'chase') {
      if (acquired) {
        this.loseTimer = 0;
        this.lastKnown.copy(this.player.position); // memoriza onde te viu
      } else {
        // Perdeu a visão (você camuflou ou saiu de vista): breve hesitação e desiste.
        this.loseTimer += dt;
        if (this.loseTimer >= LOSE_TIME) this._enterPatrol();
      }
    }
    this.validTarget = acquired;

    if (this.state === 'chase') this._doChase(dt);
    else this._doPatrol(dt);

    // Captura: distância HORIZONTAL <= CATCH_DIST E banda vertical |Δy| <= CATCH_V_TOL.
    // Preserva "grudado no alto = seguro" e corrige "mesmo andar, Y ligeiramente
    // diferente = incapturável". Camuflagem sempre protege.
    if (this.state === 'chase' && !camo) {
      const p = this.group.position, pc = this.player.position;
      const horiz = Math.hypot(p.x - pc.x, p.z - pc.z);
      if (horiz <= CATCH_DIST && Math.abs(p.y - pc.y) <= CATCH_V_TOL) {
        this.state = 'caught';
        this.onCaught && this.onCaught();
      }
    }

    this._updateVisionVisual();
    this.group.rotation.y = this.yaw;

    // Caminhada: fase avança pela distância horizontal percorrida neste frame.
    const dx = this.group.position.x - this._prevPos.x;
    const dz = this.group.position.z - this._prevPos.z;
    const dist = Math.hypot(dx, dz);
    this._prevPos.copy(this.group.position);

    if (this.animInstance) {
      const moving = dist > 1e-3;
      this.animInstance.playAnimation(moving ? 'run' : 'idle');
      this.animInstance.update(dt);
    } else {
      this.gait.update(dt, dist);
    }
  }

  _checkAnimInstance() {
    if (this.animInstance || !animationManager.isLoaded) return;
    const inst = animationManager.createInstance(this.bodyMat, BODY_H, { outline: true });
    if (inst) {
      if (this.toy && this.toy.group) {
        this.bodyGroup.remove(this.toy.group);
      }
      this.bodyGroup.add(inst.group);
      this.animInstance = inst;
    }
  }

  // ------------------------------------------------------------------- VISION
  _canSee(forward) {
    const eye = this._eye.copy(this.group.position);
    const pc = this.player.position;
    const cosHalf = Math.cos(VISION_HALF_ANGLE);

    // Fase 7: a penumbra saiu (cena clara). O alcance efetivo depende só de
    // agachar (furtividade). A camuflagem segue absoluta — o portão
    // acquired = sees && !camo não muda; agachar afeta só `sees`.
    const crouch = this.player.crouched ? CROUCH_VISION_MULT : 1;
    const range = VISION_RANGE * crouch;

    // Testa cabeça, centro e pés; o primeiro ponto dentro do cone, no alcance e
    // com linha de visão livre já conta como "visto".
    for (let i = 0; i < VIEW_SAMPLES.length; i++) {
      const to = this._toPlayer.set(pc.x, pc.y + VIEW_SAMPLES[i], pc.z).sub(eye);
      const dist = to.length();
      if (dist > range || dist < 1e-3) continue;

      to.multiplyScalar(1 / dist); // normaliza
      // Cone HORIZONTAL (yaw): compara só as componentes no plano XZ.
      const horiz = Math.hypot(to.x, to.z) || 1e-6;
      const cosH = (forward.x * to.x + forward.z * to.z) / horiz;
      if (cosH < cosHalf) continue;
      // Campo VERTICAL próprio (assimétrico): mais amplo para baixo que para cima.
      const vang = Math.atan2(to.y, horiz);
      if (vang > VERT_UP || vang < -VERT_DOWN) continue;

      this._ray.set(eye, to);
      this._ray.far = dist - 0.2;
      if (!this._ray.intersectObjects(this.level.occluders, false)[0]) return true;
    }
    return false;
  }

  _updateVisionVisual() {
    if (this.state === 'chase') {
      if (this.validTarget) {
        this.visionMat.color.setHex(0xffcc00); // amarelo: travado em você
        this.visionMat.opacity = 0.22;
      } else {
        // Investigando a última posição: pisca levemente em laranja.
        this.visionMat.color.setHex(0xff8c1a);
        const pulse = 0.16 + 0.09 * Math.sin(this.time * 9);
        this.visionMat.opacity = pulse;
      }
    } else {
      this.visionMat.color.setHex(0xff5a3c);   // vermelho suave: patrulha
      this.visionMat.opacity = 0.12;
    }
  }

  // -------------------------------------------------------------- MOVE STATES
  _doPatrol(dt) {
    const target = this.waypoints[this.wpIndex];
    // Alcance HORIZONTAL (não 3D): um waypoint em outro andar tem Y diferente do
    // Caçador; medir em 3D nunca o alcançaria e travaria a patrulha nesse índice.
    const p = this.group.position;
    if (Math.hypot(p.x - target.x, p.z - target.z) < WAYPOINT_REACH) {
      this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
    }
    this._moveToward(target, this.patrolSpeed, dt);
  }

  _doChase(dt) {
    // Rampa de velocidade: dá ao jogador uma janela justa para reagir e grudar.
    this.chaseRamp = Math.min(1, this.chaseRamp + dt / CHASE_RAMP);
    const speed = this.patrolSpeed + (this.chaseSpeed - this.patrolSpeed) * this.chaseRamp;
    // Persegue você se te vê; senão, corre até a última posição conhecida.
    const target = this.validTarget ? this.player.position : this.lastKnown;
    this._moveToward(target, speed, dt);
  }

  _moveToward(target, speed, dt) {
    const dx = target.x - this.group.position.x;
    const dz = target.z - this.group.position.z;
    const distToTarget = Math.hypot(dx, dz);
    if (distToTarget < 1e-3) return;

    const desired = this._steerDir.set(dx / distToTarget, 0, dz / distToTarget);
    // Só antecipa obstáculos ENTRE nós e o alvo — nunca desvia da parede onde
    // o jogador está grudado (senão o Caçador nunca fecharia a captura).
    const probeFar = Math.min(AVOID_PROBE, distToTarget - AVOID_MARGIN);
    const dir = this._steer(desired, probeFar);

    // Gira suavemente em direção ao rumo escolhido
    const desiredYaw = Math.atan2(dir.x, dir.z);
    this.yaw = approachAngle(this.yaw, desiredYaw, TURN_RATE * dt);

    this.group.position.x += dir.x * speed * dt;
    this.group.position.z += dir.z * speed * dt;
    // Y pela SONDA DE CHÃO (rampa/laje/degrau), não constante. A rampa dá
    // interpolação de graça e cobre o mezanino sem caso especial; falha em
    // segurança (sem hit → mantém o Y anterior, não cai no vazio).
    this.group.position.y = this._groundY(this.group.position.x, this.group.position.z, this.group.position.y);
  }

  // Sonda vertical contra level.walkables (chão, lajes, degraus): retorna a altura
  // dos olhos sobre a superfície mais alta abaixo da origem. 1 raycast/frame/Caçador.
  _groundY(x, z, prevY) {
    const feet = prevY - EYE_Y;
    const origin = this._probeOrig.set(x, feet + FLOOR_PROBE_UP, z);
    this._probe.set(origin, DOWN);
    this._probe.far = FLOOR_PROBE_UP + FLOOR_PROBE_DOWN;
    const hit = this._probe.intersectObjects(this.level.walkables, false)[0];
    return hit ? hit.point.y + EYE_Y : prevY;
  }

  // ------------------------------------------------------ OBSTACLE AVOIDANCE
  // Desvio simples: raio frontal + "bigodes" laterais. Retorna um vetor de
  // rumo planar (pode ser o próprio `desired` se o caminho estiver livre).
  _steer(desired, probeFar) {
    if (probeFar <= 0.1) return desired; // alvo muito perto: fecha direto

    const origin = this._eye.copy(this.group.position);
    origin.y = EYE_Y;

    if (this._feelerDist(origin, desired, probeFar) === Infinity) {
      return desired; // frente livre
    }

    // Frente bloqueada: procura o menor desvio livre, preferindo o lado atual.
    for (const ang of AVOID_ANGLES) {
      const left = this._rotateY(desired, ang, this._avoidL);
      const right = this._rotateY(desired, -ang, this._avoidR);
      const lClear = this._feelerDist(origin, left, probeFar) === Infinity;
      const rClear = this._feelerDist(origin, right, probeFar) === Infinity;

      if (lClear && rClear) return this._avoidBias >= 0 ? left : right;
      if (lClear) { this._avoidBias = 1; return left; }
      if (rClear) { this._avoidBias = -1; return right; }
    }

    // Encurralado à frente: vira firme para o lado preferido para escapar.
    return this._rotateY(desired, (this._avoidBias >= 0 ? 1 : -1) * (Math.PI / 2), this._avoidL);
  }

  // Desvio usa só obstáculos VERTICAIS (climbables), não os oclusores de visão.
  // As lajes entram em occluders para bloquear a visão entre andares, mas não
  // podem ser obstáculo de navegação: subindo uma escada em direção a uma laje,
  // os whiskers leriam a borda dela como parede e o Caçador desviaria para
  // sempre, sem completar a subida. O piso é resolvido pela sonda de chão.
  _feelerDist(origin, dir, far) {
    this._ray.set(origin, dir);
    this._ray.far = far;
    const hit = this._ray.intersectObjects(this.level.climbables, false)[0];
    return hit ? hit.distance : Infinity;
  }

  _rotateY(v, ang, out) {
    const c = Math.cos(ang), s = Math.sin(ang);
    return out.set(v.x * c + v.z * s, 0, -v.x * s + v.z * c);
  }

  _enterChase() {
    this.state = 'chase';
    this.loseTimer = 0;
    this.chaseRamp = 0;
    this.lastKnown.copy(this.player.position);
  }

  _enterPatrol() {
    this.state = 'patrol';
    this.loseTimer = 0;
    this.chaseRamp = 0;
    // Vai para o waypoint mais próximo para retomar a ronda
    let best = 0, bestD = Infinity;
    const p = this.group.position;
    for (let i = 0; i < this.waypoints.length; i++) {
      const w = this.waypoints[i];
      const d = Math.hypot(p.x - w.x, p.z - w.z); // horizontal (waypoints em andares distintos)
      if (d < bestD) { bestD = d; best = i; }
    }
    this.wpIndex = best;
  }

  // --------------------------------------------------------------- API DE PERIGO
  get position() { return this.group.position; }

  // Estimativa (s) até capturar o jogador, se estiver perseguindo e vendo-o.
  // Infinity quando não é uma ameaça imediata (patrulha, camuflado, fora de vista).
  timeToCatch(playerPos) {
    if (this.state !== 'chase' || !this.validTarget) return Infinity;
    const p = this.group.position;
    const d = Math.hypot(p.x - playerPos.x, p.z - playerPos.z); // horizontal
    return Math.max(0, (d - CATCH_DIST) / this.chaseSpeed);
  }
}

// Aproxima um ângulo de outro respeitando o menor arco, limitado por maxStep.
function approachAngle(current, target, maxStep) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}
