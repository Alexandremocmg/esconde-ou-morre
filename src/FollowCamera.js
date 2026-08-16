import * as THREE from 'three';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
// Distâncias reaproximadas (~metade) para acompanhar o jogador reduzido em 50%
// (Player SCALE=0.5): mantém o personagem no mesmo tamanho aparente na tela.
const DIST = 3.5;   // distância atrás do jogador
const HEIGHT = 1.9; // elevação ao longo do "up"
const POS_LERP = 6; // suavização de posição
const UP_LERP = 5;  // suavização do vetor up (reorientação na parede)
const MIN_DIST = 1.3; // distância mín. da câmera quando espremida contra parede
const LOOK_SENS = 0.005;  // rad por px de arrasto (área direita da tela)
const PITCH_MIN = -0.5;   // olhar p/ baixo (limite)
const PITCH_MAX = 0.6;    // olhar p/ cima (limite; baixo o bastante p/ não furar o teto/laje)
const YAW_RECENTER = 0.6; // taxa (1/s) com que o yaw volta a ficar atrás do jogador ao andar

// Câmera de 3ª pessoa que segue o jogador e reorienta o "up" para
// alinhar com a normal da parede quando ele está grudado.
export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this._desiredPos = new THREE.Vector3();
    this._up = new THREE.Vector3().copy(WORLD_UP);
    this._targetUp = new THREE.Vector3().copy(WORLD_UP);
    this._back = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._prevXZ = null; // posição XZ do jogador no frame anterior (p/ recenter do yaw)
    this._camRay = new THREE.Raycaster();
    this._camDir = new THREE.Vector3();

    this.yaw = 0;
    this.pitch = 0;
    this.distance = DIST; // 1.8m a 7.5m (ajustável por pinch)

    camera.position.set(0, HEIGHT, 6 + DIST);
    camera.up.copy(WORLD_UP);
    camera.lookAt(0, 1, 6);
  }

  reset() {
    this.yaw = 0;
    this.pitch = 0;
    this.distance = DIST;
    this._prevXZ = null;
    this._up.copy(WORLD_UP);
    this._targetUp.copy(WORLD_UP);
  }

  // Arrasto do usuário (área direita): gira/inclina a câmera de acompanhamento.
  addLook(dx, dy) {
    this.yaw -= dx * LOOK_SENS;
    const minPitch = Math.max(PITCH_MIN, -(HEIGHT - 0.4) / Math.max(1, this.distance));
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * LOOK_SENS, minPitch, PITCH_MAX);
  }

  // Zoom por gesto de pinça (pinch multitouch)
  addZoom(delta) {
    this.distance = THREE.MathUtils.clamp(this.distance + delta, 1.8, 7.5);
    const minPitch = Math.max(PITCH_MIN, -(HEIGHT - 0.4) / Math.max(1, this.distance));
    this.pitch = THREE.MathUtils.clamp(this.pitch, minPitch, PITCH_MAX);
  }

  update(dt, player, occluders) {
    const pos = player.position;

    if (player.state === 'latched') {
      // "Up" da tela = subida na parede; câmera afastada para fora da parede.
      this._targetUp.copy(player.climbUp);
      const outward = this._tmp.copy(player.wallNormal);
      this._back.copy(outward).multiplyScalar(this.distance)
        .addScaledVector(this._targetUp, -HEIGHT * 0.35);
    } else {
      if (this._prevXZ) {
        const moved = Math.hypot(pos.x - this._prevXZ.x, pos.z - this._prevXZ.z);
        if (moved > 0.005) this.yaw -= this.yaw * Math.min(1, YAW_RECENTER * dt);
      }
      this._targetUp.copy(WORLD_UP);
      const facing = this._tmp.set(0, 0, 1).applyQuaternion(player.object.quaternion);
      facing.setY(0);
      if (facing.lengthSq() < 1e-4) facing.set(0, 0, 1);
      facing.normalize();
      this._back.copy(facing).multiplyScalar(-this.distance);
      if (this.yaw !== 0) this._back.applyAxisAngle(WORLD_UP, this.yaw);   // olhar horizontal
      this._back.addScaledVector(WORLD_UP, HEIGHT + this.pitch * this.distance);    // olhar vertical
    }
    if (!this._prevXZ) this._prevXZ = { x: pos.x, z: pos.z };
    else { this._prevXZ.x = pos.x; this._prevXZ.z = pos.z; }

    this._desiredPos.copy(pos).add(this._back);

    // Garante que a posição desejada da câmera nunca fique abaixo do chão
    if (this._desiredPos.y < 0.35) {
      this._desiredPos.y = 0.35;
    }

    // Colisão de câmera: se houver parede entre o jogador e a posição desejada,
    // puxa a câmera para logo ANTES dela.
    if (occluders && occluders.length) {
      const want = this._camDir.copy(this._desiredPos).sub(pos);
      const dist = want.length();
      if (dist > 1e-3) {
        want.multiplyScalar(1 / dist);
        this._camRay.set(pos, want);
        this._camRay.far = dist;
        const hit = this._camRay.intersectObjects(occluders, false)[0];
        if (hit) {
          const d = Math.max(0.05, Math.min(hit.distance - 0.05, hit.distance - 0.35));
          this._desiredPos.copy(pos).addScaledVector(want, d);
          if (d < MIN_DIST) this._desiredPos.addScaledVector(this._targetUp, MIN_DIST - d);
        }
      }
    }

    // Suaviza posição e up
    this.camera.position.lerp(this._desiredPos, Math.min(1, POS_LERP * dt));

    // Trava de segurança: a câmera nunca pode afundar no chão (Y < 0.35)
    if (this.camera.position.y < 0.35) {
      this.camera.position.y = 0.35;
    }

    // Guarda final (defesa em profundidade): a câmera NUNCA pode ficar dentro de
    // um sólido — é o que produz a "tela preta". O raycast acima cobre o caso
    // normal (parede entre jogador e câmera), mas não a câmera nascer já dentro
    // de um volume nem passar por dentro durante a suavização. Aplicada na
    // posição FINAL: se estiver dentro de uma AABB, ejeta na horizontal EM
    // DIREÇÃO AO JOGADOR (para dentro do cômodo) — antes ela subia para o topo da
    // parede (~8 m, acima do teto) e o jogador via o vão escuro nas quinas.
    this._unstick(this.camera.position, pos, player.level && player.level.solids);

    this._up.lerp(this._targetUp, Math.min(1, UP_LERP * dt)).normalize();
    this.camera.up.copy(this._up);
    this.camera.lookAt(pos);
  }

  // Empurra `p` (câmera) para fora de qualquer AABB sólida que o contenha,
  // ejetando na HORIZONTAL em direção a `target` (o jogador) — assim a câmera sai
  // pela face que dá para dentro do cômodo, nunca para fora da mansão nem para
  // cima do teto. Poucas passadas: sair de um volume pode entrar em outro.
  _unstick(p, target, solids) {
    if (!solids) return;
    const M = 0.06; // folga
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const b of solids) {
        if (!b.containsPoint(p)) continue;
        // Custo de sair por cada face na direção do jogador (o alvo).
        const exitX = (target.x >= p.x) ? (b.max.x - p.x) : (p.x - b.min.x);
        const exitZ = (target.z >= p.z) ? (b.max.z - p.z) : (p.z - b.min.z);
        if (exitX <= exitZ) p.x += (target.x >= p.x ? 1 : -1) * (exitX + M);
        else p.z += (target.z >= p.z ? 1 : -1) * (exitZ + M);
        moved = true;
      }
      if (!moved) return;
    }
  }
}
