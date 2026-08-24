import * as THREE from 'three';
import { animationManager } from './AnimationManager.js?v=3';
import { toonGradient } from './textures.js?v=3';
import { approachAngle } from './Seeker.js?v=4';
import { TUNE } from './Tuning.js?v=1';

// Alvo do modo Caçador jogável (Game.js): um Camaleão-boneco plantado num ponto
// navegável da mansão (reaproveita level.routes — já validados como livres de
// colisão/paredes pelo AI do Seeker, ver Level.js._setRoutes). Desde o Plano 3
// (docs/MECANICA_CACADOR_VISAO.md §3), ganha vida própria: vagueia pela própria
// rota, foge ao ser avistado pela lanterna do Caçador e recolore periodicamente
// pra combinar com o entorno — locomoção adaptada de Seeker.js (IA já validada
// no modo espelho, Camaleão solo), com o papel invertido (foge, não persegue).

const EYE_Y = 1.1;  // mesma referência de pés de Seeker.js (routes já vêm nessa altura)
// Mesma altura do Camaleão jogável (Player.js: HALF_EXTENT*2, SCALE=0.8). Ficou presa
// em 0.9 (o valor de quando Player.js usava SCALE=0.5) por duas rodadas de aumento do
// jogador — os bonecos-alvo do modo Caçador solo renderizavam ~40% menores que o
// próprio jogador. Padronizado de volta pra bater com Player.js.
const HEIGHT = 1.44;
// Raio de colisão do corpo: mesma proporção do Camaleão jogável (Player.js
// RADIUS=0.45*SCALE=0.8 → 0.36), não do Seeker (BODY_R=0.6, corpo de Caçador
// maior) — o alvo tem o tamanho de um jogador, não de um Caçador.
const BODY_R = 0.36;

// Locomoção adaptada de Seeker.js:412-628 (bigodes de desvio + colisão-deslizante
// + anti-trava, validados em produção no modo Camaleão solo). Papel invertido:
// aqui o alvo vagueia/foge, nunca persegue — por isso sem CATCH_DIST/rampa de
// caça. Constantes próprias, mais lentas que as do Seeker (o alvo não é ameaça).
// Débito técnico consciente: duplicado, não extraído, pra não arriscar regressão
// numa IA (Seeker) que já está validada — ver Plano 3 no arquivo de plano.
const TURN_RATE = 3.0;
const WAYPOINT_REACH = 1.0;
const AVOID_PROBE = 2.0;
const AVOID_MARGIN = 0.5;
const AVOID_ANGLES = [0.45, 0.9, 1.35];
const SLIDE_TIME = 1.0;
const SLIDE_MIN = 0.25;
const FLOOR_PROBE_UP = 0.5;
const FLOOR_PROBE_DOWN = 2.5;
const DOWN = new THREE.Vector3(0, -1, 0);
const WANDER_SPEED = 2.0; // mais lento que o PATROL_SPEED do Seeker (3.2)

// Avistamento e fuga (Fase C do Plano 3): o alvo foge quando entra no cone da
// lanterna do Caçador (spotRange/spotCosHalf, vindos de opts — mesmos números
// de Game._addHunterFlashlight) sem oclusão contra level.occluders (não
// climbables — occluders também bloqueia visão entre lajes/andares, mesmo
// padrão de Seeker._canSee, Seeker.js:369).
//
// O alvo de fuga é sempre um WAYPOINT DA PRÓPRIA ROTA (o mais distante do
// Caçador no momento), não um ponto sintético projetado à frente — testado e
// descartado: um ponto "posição - direção_do_caçador × N metros" pode cair
// além de uma parede (sem garantia de alcançabilidade, ao contrário da
// posição real do jogador que Seeker.js persegue). Isso travava o alvo pra
// sempre quando o Caçador o encurralava perto de um canto — exatamente o
// cenário que este plano pediu pra testar. Waypoints já são pontos
// comprovadamente navegáveis (mesmos usados pelo wander), então reaproveitá-
// los garante que a fuga NUNCA mira um lugar inalcançável.
const FLEE_SPEED = 4.0;         // mais lento que o CHASE_SPEED do Seeker (6.2) — o Caçador precisa ter chance
const FLEE_SPEED_MARGIN = 1.2;  // fuga sempre >= 1.2 m/s mais lenta que TUNE.moveSpeed AO VIVO
const LOSE_TIME = 1.2;          // s sem ser visto até voltar a vaguear (histerese, evita flicker de estado)
const SPOT_UP = new THREE.Vector3(0, 0.3, 0); // mesmo espírito do offset de mira de Game.fireHunterShot

// Camuflagem periódica (Fase D do Plano 3): reaproveita o MESMO padrão de
// raycast que Player.sampleColor usa contra level.colorables (Player.js), mas
// só a parte de AMOSTRAR cor — sem zonas upper/lower nem carimbo de textura
// (o alvo é uma malha simples, sem esse conceito). Piso genérico NÃO é
// colorable (Level.js: "não-colorável → cor livre") — só paredes/móveis/
// tapetes entram, por isso os raios são HORIZONTAIS, não pra baixo.
const RECOLOR_RANGE = 3.2;
const RECOLOR_ANGLES = [0, -0.7, 0.7, Math.PI]; // relativos ao yaw: frente, diagonais, trás
const RECOLOR_INTERVAL = 6;        // s entre trocas de cor, vagueando
const RECOLOR_INTERVAL_FLEE = 2.2; // troca mais rápido fugindo (mais visível, mais tentativas de se camuflar)
const RECOLOR_LERP_RATE = 3;       // 1/s — transição suave, evita "pop" de cor

export class ChameleonTarget {
  constructor(scene, level, point, opts = {}) {
    this.level = level;
    this.eliminated = false;
    this._fade = 0; // 0..1 ao ser eliminado (encolhe e some)

    // Rota própria (Level.routes[routeIndex]) e cone de "avistamento" da
    // lanterna do Caçador (mesmos números de Game._addHunterFlashlight) —
    // usados a partir da Fase B/C do Plano 3; ainda não consumidos aqui.
    this.waypoints = opts.waypoints || [];
    this.spotRange = opts.spotRange || 14;
    this.spotCosHalf = Math.cos(THREE.MathUtils.degToRad(opts.spotHalfAngleDeg || 28));
    this.difficulty = opts.difficulty || 1;

    const color = opts.color != null ? opts.color : 0x5fbf6e;

    this.group = new THREE.Group();
    this.group.position.copy(point);
    scene.add(this.group);

    // Mesmo deslocamento do Seeker: o grupo lógico fica na altura dos "olhos";
    // o corpo visual desce para os pés encostarem no chão/laje.
    this.bodyGroup = new THREE.Group();
    this.bodyGroup.position.y = -EYE_Y;
    this.group.add(this.bodyGroup);

    this.bodyMat = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    this.animInstance = null;
    this._checkAnimInstance();

    // Estado de IA (Plano 3): 'wander' (vagueia pela rota) | 'flee' (Fase C) |
    // eliminated é rastreado à parte (this.eliminated), não é um 3º estado aqui.
    this.state = 'wander';
    this.yaw = Math.random() * Math.PI * 2; // dessincroniza o giro inicial dos 6 alvos
    // Começa mirando o waypoint mais próximo do ponto de spawn, não o índice 0 —
    // senão o alvo daria um salto de rumo estranho no primeiro frame.
    this.wpIndex = 0;
    if (this.waypoints.length) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < this.waypoints.length; i++) {
        const w = this.waypoints[i];
        const d = Math.hypot(point.x - w.x, point.z - w.z);
        if (d < bestD) { bestD = d; best = i; }
      }
      this.wpIndex = best;
    }
    // Escala por estágio (Fase E do Plano 3): mesmo padrão linear que
    // Seeker.js:89-93 já usa pro Caçador-IA — fuga/vagueio aceleram, a
    // recamuflagem fica mais frequente e o alvo "relaxa" mais devagar depois
    // de sumir de vista (loseTime maior = mais esperto, não só mais rápido).
    const diff = this.difficulty;
    this.wanderSpeed = WANDER_SPEED * (1 + (diff - 1) * 0.3);
    this.fleeSpeed = FLEE_SPEED + (diff - 1) * 1.4; // capado ao vivo contra TUNE.moveSpeed no update (Fase C)
    this.loseTime = LOSE_TIME + (diff - 1) * 0.4;
    this.loseTimer = 0;
    this.recolorInterval = RECOLOR_INTERVAL / (1 + (diff - 1) * 0.5);
    // Dessincroniza os 6 alvos (senão todos trocam de cor no mesmo instante) e
    // já entra com uma tentativa de camuflagem real, não o verde padrão cru.
    this._recolorTimer = Math.random() * this.recolorInterval;
    this._targetColor = this.bodyMat.color.clone();

    this._prevPos = this.group.position.clone();
    this._bestDist = Infinity;
    this._noImproveT = 0;
    this._unstickT = 0;
    this._slideT = 0;
    this._slideX = 0; this._slideZ = 0;
    this._pushX = 0; this._pushZ = 0;
    this._avoidBias = 1;

    this._ray = new THREE.Raycaster();
    this._steerDir = new THREE.Vector3();
    this._avoidL = new THREE.Vector3();
    this._avoidR = new THREE.Vector3();
    this._probe = new THREE.Raycaster();
    this._probeOrig = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._toCam = new THREE.Vector3();
    this._tmpTarget = new THREE.Vector3();
    this._recolorDir = new THREE.Vector3();

    // Já entra tentando combinar com o entorno, em vez de esperar o 1º timer
    // (senão o alvo fica visivelmente verde-cru por até RECOLOR_INTERVAL segundos).
    this._recolor();
  }

  // O GLB pode ainda não ter carregado quando o alvo é criado (spawn no boot
  // da partida) — mesmo padrão de lazy-attach do Seeker/Player.
  _checkAnimInstance() {
    if (this.animInstance || !animationManager.isLoaded) return;
    // Sem contorno: um alvo parado com borda de desenho se denunciaria à distância
    // (docs/MECANICA_CACADOR_VISAO.md §1 — "sem contornos/realces" no que o Caçador vê).
    const inst = animationManager.createInstance(this.bodyMat, HEIGHT);
    if (inst) {
      this.bodyGroup.add(inst.group);
      this.animInstance = inst;
      inst.playAnimation('idle');
    }
  }

  get position() { return this.group.position; }

  // Chamado pelo Game ao acertar o jato de água. Retorna false se já tinha
  // sido eliminado (evita contar o mesmo alvo duas vezes).
  hit() {
    if (this.eliminated) return false;
    this.eliminated = true;
    if (this.animInstance && this.animInstance.actions['prone']) {
      this.animInstance.playAnimation('prone');
    }
    return true;
  }

  update(dt, camera) {
    this._checkAnimInstance();
    if (this.animInstance) this.animInstance.update(dt);

    if (this.eliminated) {
      this._fade = Math.min(1, this._fade + dt * 1.5);
      const s = Math.max(0.001, 1 - this._fade);
      this.group.scale.setScalar(s);
      if (this._fade >= 1) this.group.visible = false;
      return;
    }
    if (!this.waypoints.length) return; // sem rota atribuída (não deveria acontecer)

    // Fuga sempre um pouco mais lenta que o Caçador AO VIVO (lê TUNE.moveSpeed
    // a cada frame — o painel ⚙️ pode mudar isso em runtime): o mesmo "teto de
    // justiça" que Seeker.js já aplica na perseguição, com o papel invertido.
    this._fleeSpeedLive = Math.min(this.fleeSpeed, Math.max(2, TUNE.moveSpeed - FLEE_SPEED_MARGIN));
    const spotted = camera ? this._isSpotted(camera) : false;
    if (this.state === 'wander') {
      if (spotted) this._enterFlee(camera);
    } else if (this.state === 'flee') {
      if (spotted) this.loseTimer = 0;
      else {
        this.loseTimer += dt;
        if (this.loseTimer >= this.loseTime) this._enterWander();
      }
    }

    if (this.state === 'flee') this._doFlee(dt, camera);
    else this._doWander(dt);
    this.group.rotation.y = this.yaw;

    this._recolorTimer -= dt;
    if (this._recolorTimer <= 0) {
      const interval = this.state === 'flee' ? RECOLOR_INTERVAL_FLEE : this.recolorInterval;
      this._recolorTimer = interval * (0.75 + Math.random() * 0.5); // jitter: evita ritmo robótico
      this._recolor();
    }
    this.bodyMat.color.lerp(this._targetColor, Math.min(1, dt * RECOLOR_LERP_RATE));

    const dx = this.group.position.x - this._prevPos.x;
    const dz = this.group.position.z - this._prevPos.z;
    const dist = Math.hypot(dx, dz);
    this._prevPos.copy(this.group.position);
    if (this.animInstance) {
      const clip = dist > 1e-3 ? 'run' : 'idle';
      this.animInstance.playAnimation(this.animInstance.actions[clip] ? clip : 'idle');
    }
  }

  // ------------------------------------------------------------- AVISTAMENTO
  // Papel invertido de Seeker._canSee (Seeker.js:340-372): lá o Seeker enxerga
  // o jogador; aqui é o CAÇADOR (câmera 1ª pessoa humana) que precisa enxergar
  // o alvo. Cone 3D simples (ângulo + alcance) em vez da amostragem volumétrica
  // do Seeker — não precisamos da mesma precisão pra decidir "fui visto".
  _isSpotted(camera) {
    const eye = camera.position;
    const dir = camera.getWorldDirection(this._camDir);
    const targetPos = this._tmpTarget.copy(this.position).add(SPOT_UP);
    const toT = this._toCam.subVectors(targetPos, eye);
    const dist = toT.length();
    if (dist > this.spotRange || dist < 1e-3) return false;
    toT.multiplyScalar(1 / dist);
    if (dir.dot(toT) < this.spotCosHalf) return false;
    this._ray.set(eye, toT);
    this._ray.far = Math.max(0, dist - 0.15);
    return this._ray.intersectObjects(this.level.occluders, false).length === 0;
  }

  _enterFlee(camera) {
    this.state = 'flee';
    this.loseTimer = 0;
    this.wpIndex = this._pickFleeWaypoint(camera);
    this._resetUnstick();
  }

  // O waypoint da própria rota mais distante do Caçador AGORA — reaproveita o
  // mesmo padrão de "escolhe o waypoint mais próximo" de _enterWander, só que
  // maximizando em vez de minimizando a distância (ao Caçador, não ao alvo).
  _pickFleeWaypoint(camera) {
    let best = this.wpIndex, bestD = -Infinity;
    const cx = camera.position.x, cz = camera.position.z;
    for (let i = 0; i < this.waypoints.length; i++) {
      const w = this.waypoints[i];
      const d = Math.hypot(w.x - cx, w.z - cz);
      if (d > bestD) { bestD = d; best = i; }
    }
    return best;
  }

  _enterWander() {
    this.state = 'wander';
    this.loseTimer = 0;
    // Volta pelo waypoint mais próximo, não o índice onde parou — evita um
    // salto de rumo estranho depois de fugir pra longe da rota.
    let best = 0, bestD = Infinity;
    const p = this.group.position;
    for (let i = 0; i < this.waypoints.length; i++) {
      const w = this.waypoints[i];
      const d = Math.hypot(p.x - w.x, p.z - w.z);
      if (d < bestD) { bestD = d; best = i; }
    }
    this.wpIndex = best;
    this._resetUnstick();
  }

  // -------------------------------------------------------------- MOVE STATES
  _doWander(dt) {
    const wp = this.waypoints[this.wpIndex];
    if (!wp) return;
    const p = this.group.position;
    if (Math.hypot(p.x - wp.x, p.z - wp.z) < WAYPOINT_REACH) {
      this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
    }
    this._moveToward(wp, this.wanderSpeed, dt);
  }

  // Foge em direção ao waypoint da própria rota mais distante do Caçador —
  // ao chegar nele (ou se o Caçador se moveu bastante), escolhe outro. Sempre
  // um ponto real da rota, nunca um ponto sintético fora dela (ver comentário
  // de FLEE_SPEED acima — essa era a causa de um travamento em cantos).
  _doFlee(dt, camera) {
    const wp = this.waypoints[this.wpIndex];
    if (!wp) return;
    const p = this.group.position;
    if (Math.hypot(p.x - wp.x, p.z - wp.z) < WAYPOINT_REACH) {
      this.wpIndex = this._pickFleeWaypoint(camera);
    }
    this._moveToward(this.waypoints[this.wpIndex], this._fleeSpeedLive, dt);
  }

  // Adaptado de Seeker._moveToward (Seeker.js:412-495) — mesmo algoritmo de
  // direção desejada + bigodes + colisão-deslizante + anti-trava. Sem rampa de
  // velocidade nem alvo dinâmico (aqui o alvo é sempre um ponto fixo por frame).
  _moveToward(target, speed, dt) {
    const dx = target.x - this.group.position.x;
    const dz = target.z - this.group.position.z;
    const distToTarget = Math.hypot(dx, dz);
    if (distToTarget < 1e-3) return;

    const desired = this._steerDir.set(dx / distToTarget, 0, dz / distToTarget);
    const probeFar = Math.min(AVOID_PROBE, distToTarget - AVOID_MARGIN);
    const dir = this._unstickT > 0 ? desired : this._steer(desired, probeFar);

    const desiredYaw = Math.atan2(dir.x, dir.z);
    this.yaw = approachAngle(this.yaw, desiredYaw, TURN_RATE * dt);

    const step = speed * dt;
    const beforeX = this.group.position.x, beforeZ = this.group.position.z;
    let mvx = dir.x, mvz = dir.z;
    if (this._slideT > 0) {
      const andou = SLIDE_TIME - this._slideT;
      if (andou > SLIDE_MIN && this._pathClear(target.x, target.z)) this._slideT = 0;
      else { mvx = this._slideX; mvz = this._slideZ; this._slideT -= dt; }
    }
    this.group.position.x += mvx * step;
    this.group.position.z += mvz * step;
    this._resolveSolids();

    const movedLen = Math.hypot(this.group.position.x - beforeX, this.group.position.z - beforeZ);
    const pushLen = Math.hypot(this._pushX, this._pushZ);
    if (pushLen > 1e-6 && movedLen < 0.35 * step) {
      const nx = this._pushX / pushLen, nz = this._pushZ / pushLen;
      let tx = -nz, tz = nx;
      const along = tx * dir.x + tz * dir.z;
      if (along < -0.05 || (Math.abs(along) <= 0.05 && this._avoidBias < 0)) { tx = nz; tz = -nx; }
      this._slideX = tx; this._slideZ = tz; this._slideT = SLIDE_TIME;
      this.group.position.x += tx * step;
      this.group.position.z += tz * step;
      this._resolveSolids();
      this.yaw = approachAngle(this.yaw, Math.atan2(tx, tz), TURN_RATE * dt);
    }
    this.group.position.y = this._groundY(this.group.position.x, this.group.position.z, this.group.position.y);

    const newDist = Math.hypot(target.x - this.group.position.x, target.z - this.group.position.z);
    if (newDist < this._bestDist - 0.1) { this._bestDist = newDist; this._noImproveT = 0; }
    else this._noImproveT += dt;
    this._unstickT = this._noImproveT > 0.5 ? 1.2 : Math.max(0, this._unstickT - dt);
    if (this._noImproveT > 1.8) { this._avoidBias = -this._avoidBias; this._noImproveT = 0; this._bestDist = newDist; }
  }

  _groundY(x, z, prevY) {
    const feet = prevY - EYE_Y;
    const origin = this._probeOrig.set(x, feet + FLOOR_PROBE_UP, z);
    this._probe.set(origin, DOWN);
    this._probe.far = FLOOR_PROBE_UP + FLOOR_PROBE_DOWN;
    const hit = this._probe.intersectObjects(this.level.walkables, false)[0];
    return hit ? hit.point.y + EYE_Y : prevY;
  }

  _resolveSolids() {
    const STEP_UP = 0.30;
    const p = this.group.position;
    const feet = p.y - EYE_Y, top = feet + HEIGHT;
    const r = BODY_R, r2 = r * r;
    this._pushX = 0; this._pushZ = 0;
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (const box of this.level.solids) {
        if (box.seekerPass) continue;
        if (box.min.y >= top || box.max.y <= feet) continue;
        if (box.max.y <= feet + STEP_UP) continue;
        const cx = Math.min(Math.max(p.x, box.min.x), box.max.x);
        const cz = Math.min(Math.max(p.z, box.min.z), box.max.z);
        const dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > 1e-8) {
          if (d2 >= r2) continue;
          const dist = Math.sqrt(d2), push = (r - dist) / dist;
          p.x += dx * push; p.z += dz * push; moved = true;
          this._pushX += dx * push; this._pushZ += dz * push;
        } else {
          const midX = (box.min.x + box.max.x) * 0.5, midZ = (box.min.z + box.max.z) * 0.5;
          const penX = Math.min(p.x - box.min.x, box.max.x - p.x);
          const penZ = Math.min(p.z - box.min.z, box.max.z - p.z);
          if (penX < penZ) p.x += (p.x >= midX ? 1 : -1) * (penX + r);
          else p.z += (p.z >= midZ ? 1 : -1) * (penZ + r);
          moved = true;
        }
      }
      if (!moved) return;
    }
  }

  _pathClear(tx, tz) {
    const STEP_UP = 0.30, MAX = 8;
    const p = this.group.position;
    const feet = p.y - EYE_Y, top = feet + HEIGHT;
    let dx = tx - p.x, dz = tz - p.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return true;
    const lim = Math.min(len, MAX);
    dx /= len; dz /= len;
    for (const box of this.level.solids) {
      if (box.seekerPass) continue;
      if (box.min.y >= top || box.max.y <= feet) continue;
      if (box.max.y <= feet + STEP_UP) continue;
      const minX = box.min.x - BODY_R, maxX = box.max.x + BODY_R;
      const minZ = box.min.z - BODY_R, maxZ = box.max.z + BODY_R;
      let t0 = 0, t1 = lim;
      if (Math.abs(dx) < 1e-9) { if (p.x < minX || p.x > maxX) continue; }
      else {
        let a = (minX - p.x) / dx, b = (maxX - p.x) / dx;
        if (a > b) { const s = a; a = b; b = s; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        if (t0 > t1) continue;
      }
      if (Math.abs(dz) < 1e-9) { if (p.z < minZ || p.z > maxZ) continue; }
      else {
        let a = (minZ - p.z) / dz, b = (maxZ - p.z) / dz;
        if (a > b) { const s = a; a = b; b = s; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        if (t0 > t1) continue;
      }
      return false;
    }
    return true;
  }

  // ------------------------------------------------------ OBSTACLE AVOIDANCE
  _steer(desired, probeFar) {
    if (probeFar <= 0.1) return desired;

    const origin = this._eye.copy(this.group.position);
    origin.y = EYE_Y;

    if (this._feelerDist(origin, desired, probeFar) === Infinity) {
      return desired;
    }

    for (const ang of AVOID_ANGLES) {
      const left = this._rotateY(desired, ang, this._avoidL);
      const right = this._rotateY(desired, -ang, this._avoidR);
      const lClear = this._feelerDist(origin, left, probeFar) === Infinity;
      const rClear = this._feelerDist(origin, right, probeFar) === Infinity;

      if (lClear && rClear) return this._avoidBias >= 0 ? left : right;
      if (lClear) { this._avoidBias = 1; return left; }
      if (rClear) { this._avoidBias = -1; return right; }
    }

    return this._rotateY(desired, (this._avoidBias >= 0 ? 1 : -1) * (Math.PI / 2), this._avoidL);
  }

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

  _resetUnstick() { this._bestDist = Infinity; this._noImproveT = 0; this._unstickT = 0; }

  // -------------------------------------------------------------- CAMUFLAGEM
  // Amostra a cor real de uma superfície próxima, testando alguns raios
  // horizontais ao redor do alvo (não pra baixo — o piso genérico não é
  // colorable, ver comentário de RECOLOR_RANGE acima). Sem hit em nenhum
  // ângulo (ex.: corredor vazio): mantém a última cor, sem erro nem flicker.
  _recolor() {
    const colorables = this.level.colorables;
    if (!colorables || !colorables.length) return;
    const origin = this.group.position;
    let best = null, bestDist = Infinity;
    for (const a of RECOLOR_ANGLES) {
      const ang = this.yaw + a;
      this._recolorDir.set(Math.sin(ang), 0, Math.cos(ang));
      this._ray.set(origin, this._recolorDir);
      this._ray.far = RECOLOR_RANGE;
      const hit = this._ray.intersectObjects(colorables, false)[0];
      if (hit && hit.distance < bestDist) { bestDist = hit.distance; best = hit; }
    }
    if (best && best.object.material && best.object.material.color) {
      this._targetColor.copy(best.object.material.color);
    }
  }

  destroy() {
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
