import * as THREE from 'three';

// Parâmetros do Caçador
const BODY_R = 0.6;
const BODY_H = 2.2;
const EYE_Y = 1.1;                    // altura dos "olhos" (origem da visão)
const PATROL_SPEED = 3.2;
const CHASE_SPEED = 6.2;
const CHASE_RAMP = 0.5;               // s para acelerar de patrulha até velocidade de caça
const TURN_RATE = 3.5;                // rad/s de giro
const VISION_RANGE = 12;
const VISION_HALF_ANGLE = Math.PI / 7; // ~25.7° (cone total ~51°)
const CATCH_DIST = 1.5;
const WAYPOINT_REACH = 1.2;
const LOSE_TIME = 0.8;                // s sem alvo válido (camuflado OU fora de vista) até desistir

// Desvio simples de obstáculos (whiskers)
const AVOID_PROBE = 2.4;              // alcance de antecipação à frente (m)
const AVOID_MARGIN = 0.6;            // não desvia do próprio alvo (recuo do alcance)
const AVOID_ANGLES = [0.45, 0.9, 1.35]; // rad testados p/ cada lado

// Rota padrão: perímetro em sentido horário.
const WAYPOINTS = [
  new THREE.Vector3(-12, EYE_Y, -12),
  new THREE.Vector3(12, EYE_Y, -12),
  new THREE.Vector3(12, EYE_Y, 12),
  new THREE.Vector3(-12, EYE_Y, 12),
  new THREE.Vector3(0, EYE_Y, 0),
];

// Rota alternada (2º Caçador): cruza o mapa em diagonal e sentido oposto,
// para cobrir corredores diferentes e forçar o uso constante da camuflagem.
export const WAYPOINTS_ALT = [
  new THREE.Vector3(12, EYE_Y, 12),
  new THREE.Vector3(-12, EYE_Y, 12),
  new THREE.Vector3(0, EYE_Y, -2),
  new THREE.Vector3(12, EYE_Y, -12),
  new THREE.Vector3(-12, EYE_Y, -12),
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
    this.group.position.set(this.waypoints[0].x, EYE_Y, this.waypoints[0].z);

    // Corpo: cilindro (vermelho por padrão; cor distinta p/ o 2º Caçador)
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(BODY_R, BODY_R * 0.85, BODY_H, 20),
      new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.5, metalness: 0.1 })
    );
    body.castShadow = true;
    this.group.add(body);

    // "Visor" indicando a frente (+Z)
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.28, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x140505, emissive: 0x330000 })
    );
    visor.position.set(0, 0.55, BODY_R + 0.02);
    this.group.add(visor);

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
    this.group.add(cone);

    scene.add(this.group);

    this._ray = new THREE.Raycaster();
    this._toPlayer = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._steerDir = new THREE.Vector3();
    this._avoidL = new THREE.Vector3();
    this._avoidR = new THREE.Vector3();
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

    // Captura: só pega o jogador visível/não camuflado (camuflagem sempre protege).
    if (this.state === 'chase' && !camo) {
      const d = this.group.position.distanceTo(this.player.position);
      if (d <= CATCH_DIST) {
        this.state = 'caught';
        this.onCaught && this.onCaught();
      }
    }

    this._updateVisionVisual();
    this.group.rotation.y = this.yaw;
  }

  // ------------------------------------------------------------------- VISION
  _canSee(forward) {
    const p = this.player.position;
    this._toPlayer.subVectors(p, this.group.position);
    const dist = this._toPlayer.length();
    if (dist > VISION_RANGE || dist < 1e-3) return false;

    this._toPlayer.multiplyScalar(1 / dist); // normaliza
    if (forward.dot(this._toPlayer) < Math.cos(VISION_HALF_ANGLE)) return false;

    // Linha de visão: algo sólido entre o Caçador e o jogador bloqueia?
    this._eye.copy(this.group.position);
    this._ray.set(this._eye, this._toPlayer);
    this._ray.far = dist - 0.2;
    const blocked = this._ray.intersectObjects(this.level.occluders, false)[0];
    return !blocked;
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
    if (this.group.position.distanceTo(target) < WAYPOINT_REACH) {
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
    this.group.position.y = EYE_Y;
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

  _feelerDist(origin, dir, far) {
    this._ray.set(origin, dir);
    this._ray.far = far;
    const hit = this._ray.intersectObjects(this.level.occluders, false)[0];
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
    for (let i = 0; i < this.waypoints.length; i++) {
      const d = this.group.position.distanceTo(this.waypoints[i]);
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
    const d = this.group.position.distanceTo(playerPos);
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
